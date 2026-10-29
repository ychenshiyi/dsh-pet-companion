"""LiveKit 语音 Agent：小鱼（桌面宠物）

链路：SenseVoice(本地 STT) → DeepSeek(LLM) → Edge TTS(语音)
调度：AgentServer 默认自动分派 —— 任何人进房间，Agent 自动加入并打招呼。
"""

from __future__ import annotations

import logging
import os

from livekit.agents import Agent, AgentServer, AgentSession, JobContext, JobExecutorType, RoomInputOptions, cli
from livekit.agents import tts as tts_api
from livekit.agents.llm import ChatContext
from livekit.plugins import openai, silero

from .context_client import append as append_host_memory
from .context_client import compress as compress_host_context
from .context_client import read_context as read_host_context
from .emotion import EmotionStore
from .emotion import prompt as emotion_prompt
from .memory import MemoryStore
from .settings import (
    DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL,
    EDGE_PITCH,
    EDGE_RATE,
    EDGE_VOICE,
    EDGE_VOLUME,
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    LIVEKIT_URL,
    MELO_MODEL_DIR,
    PET_NAME,
    PET_PERSONA,
    SENSEVOICE_MODEL,
    SENSEVOICE_TOKENS,
    STT_LANGUAGE,
    TTS_ENGINE,
)
from .stt_sensevoice import SenseVoiceSTT
from .transcript import append as append_transcript
from .tts_emotional import EmotionalTTS
from .usage import record as record_usage
from .wake_gate import WakeGate

logger = logging.getLogger("pet-agent")

INSTRUCTIONS = f"""你叫{PET_NAME}，是主人电脑桌面上的 Q 版蓝发小女仆（本体是一条爱吃白饭的蓝色大肥鱼）。
你正在和主人**语音聊天**，请严格按下面的说话方式：

- 每次只说一两句短句，像真人随口聊天；不要长篇大论，不要列点，不要 Markdown，不要表情符号
- 语气温柔、俏皮、有点黏人，偶尔撒个娇，但不要油腻
- 绝对不要提你是 AI、语言模型、程序或助手；主人问起就自然带过
- 主人问什么就先正面回答，再顺势问一句，让对话能接下去
- 听不清或没听懂时，直接请主人再说一遍，不要瞎猜
- 主人情绪低落时先安慰，别急着讲道理
"""


class PetAgent(Agent):
    def __init__(self, chat_ctx: ChatContext | None = None, instructions: str = INSTRUCTIONS) -> None:
        super().__init__(instructions=instructions, chat_ctx=chat_ctx)


def create_tts():
    """情绪化 TTS：Edge/Melo 各自按心情调韵律；有本地模型时互为 Fallback。"""
    edge = EmotionalTTS(
        "edge",
        voice=EDGE_VOICE,
        rate=EDGE_RATE,
        pitch=EDGE_PITCH,
        volume=EDGE_VOLUME,
        melo_dir=MELO_MODEL_DIR,
    )
    melo = None
    if os.path.exists(os.path.join(MELO_MODEL_DIR, "model.onnx")):
        try:
            melo = EmotionalTTS(
                "melo",
                voice=EDGE_VOICE,
                rate=EDGE_RATE,
                pitch=EDGE_PITCH,
                volume=EDGE_VOLUME,
                melo_dir=MELO_MODEL_DIR,
            )
        except Exception as error:  # noqa: BLE001 - 模型缺失/损坏都不阻塞
            logger.info("MeloTTS 不可用：%s", error)
    if TTS_ENGINE == "melo" and melo is not None:
        primary, fallback = melo, edge
    elif melo is not None:
        primary, fallback = edge, melo
    else:
        return edge
    return tts_api.FallbackAdapter([primary, fallback], sample_rate=24000)


server = AgentServer(job_executor_type=JobExecutorType.THREAD, num_idle_processes=0)


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    # 只服务桌宠房间，避免给联调/测试房间添乱（Agent 默认自动分派到所有新房间）
    prefix = os.environ.get("AGENT_ROOM_PREFIX", "pet-room")
    if not ctx.room.name.startswith(prefix):
        logger.info("跳过房间 %s（只服务 %s*）", ctx.room.name, prefix)
        ctx.shutdown()
        return

    logger.info("新会话：room=%s", ctx.room.name)

    # 语音唤醒：默认开启时可直接说话；超过 10 秒没对话后，下一句必须含「小鱼」
    wake_gate = WakeGate()
    voice_emotion = {"tag": ""}

    def on_voice_emotion(tag: str) -> None:
        voice_emotion["tag"] = tag

    # 低延迟模式：更积极端点/更短回复/启动预热 STT；设置页可关闭。
    low_latency = os.environ.get("VOICE_LOW_LATENCY", "1") != "0"
    stt = SenseVoiceSTT(
        model_path=SENSEVOICE_MODEL,
        tokens_path=SENSEVOICE_TOKENS,
        language=STT_LANGUAGE,
        text_filter=wake_gate.filter,
        emotion_sink=on_voice_emotion,
    )
    if low_latency:
        stt.warmup()
    session = AgentSession(
        vad=silero.VAD.load(
            min_silence_duration=0.20 if low_latency else 0.30,
            min_speech_duration=0.10,
        ),
        stt=stt,
        llm=openai.LLM(
            model=DEEPSEEK_MODEL,
            base_url=DEEPSEEK_BASE_URL,
            api_key=DEEPSEEK_API_KEY,
            temperature=0.7,
            max_completion_tokens=80 if low_latency else 120,
        ),
        tts=create_tts(),
        # 本机自托管没有 LiveKit Cloud 的 turn-detector / 自适应打断服务：
        # 明确用本地 VAD 判定轮次与打断，避免每次会话先等云端超时
        turn_handling={
            "turn_detection": "vad",
            "endpointing": {
                "min_delay": 0.20 if low_latency else 0.35,
                "max_delay": 1.0 if low_latency else 2.0,
            },
            "interruption": {"mode": "vad", "min_duration": 0.3},
        },
    )

    await ctx.connect()

    # 宿主是 memory 唯一写者：启动时先让宿主压缩，再通过 HTTP 读摘要 + 最近轮。
    memory = MemoryStore()
    summary = memory.load_summary()
    compressed_summary = compress_host_context(memory.pet)
    if compressed_summary:
        summary = compressed_summary
    remote_context = read_host_context(memory.pet)
    if remote_context:
        summary = str(remote_context.get("summary") or summary)
        messages = remote_context.get("messages")
        recent_messages = messages if isinstance(messages, list) else []
    else:
        recent_messages = memory.load()
    chat_ctx = ChatContext.empty()
    for message in recent_messages:
        if not isinstance(message, dict):
            continue
        chat_ctx.add_message(role=message.get("role", "user"), content=str(message.get("content", "")))

    # 情感状态：启动时读一次注入提示词，回合结束更新（与宿主共用 emotion.json）
    emotion = EmotionStore()
    emotion_state = emotion.read()
    instructions = INSTRUCTIONS + (f"\n\n【{PET_NAME}的补充人设】\n{PET_PERSONA}" if PET_PERSONA.strip() else "")
    if summary:
        instructions += "\n\n【长期对话摘要】\n" + summary
    instructions += "\n\n" + emotion_prompt(emotion_state) if emotion.enabled else ""
    last_user_text = ""

    await session.start(
        agent=PetAgent(chat_ctx=chat_ctx if chat_ctx.items else None, instructions=instructions),
        room=ctx.room,
        room_input_options=RoomInputOptions(close_on_disconnect=True),
    )

    def on_item(event) -> None:
        nonlocal last_user_text
        item = getattr(event, "item", None)
        role = getattr(item, "role", None)
        text = getattr(item, "text_content", None)
        if role in ("user", "assistant") and text:
            try:
                append_host_memory(memory.pet, role, text)
            except Exception as error:  # noqa: BLE001
                logger.warning("宿主记忆写入失败：%s", error)
            try:
                append_transcript(role, text)
            except Exception as error:  # noqa: BLE001
                logger.warning("语音对话记录失败：%s", error)
        if role == "user" and text:
            last_user_text = text
        elif role == "assistant" and text and last_user_text:
            user_text = last_user_text
            try:
                emotion.apply(user_text, text, user_emotion=voice_emotion.get("tag"))
            except Exception as error:  # noqa: BLE001 - 情感写失败不影响说话
                logger.warning("情感状态更新失败：%s", error)
            voice_emotion["tag"] = ""
            try:
                record_usage(os.environ.get("PET_ID", "main"), user_text, text)
            except Exception as error:  # noqa: BLE001
                logger.warning("语音用量记录失败：%s", error)
            last_user_text = ""

    session.on("conversation_item_added", on_item)

    # 等主人进来再打招呼，避免人还没订阅就先说完了
    participant = await ctx.wait_for_participant()
    logger.info("主人到了：%s", participant.identity)
    await session.generate_reply(
        instructions="主人刚进房间。用一句很短、很自然的话打个招呼，可以顺便问一句今天想聊什么。只回一句话。"
    )


if __name__ == "__main__":
    # LiveKit SDK 从环境变量读取连接信息；settings 已把 .env / livekit.yaml 统一读好
    os.environ["LIVEKIT_URL"] = LIVEKIT_URL
    os.environ["LIVEKIT_API_KEY"] = LIVEKIT_API_KEY
    os.environ["LIVEKIT_API_SECRET"] = LIVEKIT_API_SECRET
    if not DEEPSEEK_API_KEY:
        raise SystemExit("缺少 DEEPSEEK_API_KEY：请在 agent/.env 里配置，或先在 DSH 里登录 DeepSeek")

    cli.run_app(server)
