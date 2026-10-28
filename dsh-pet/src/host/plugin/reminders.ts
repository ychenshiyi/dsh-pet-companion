/** 提醒/日程：单文件 JSON，到点由 host 定时器写气泡并移除。 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Reminder {
  id: string;
  text: string;
  dueAt: number;
  petId: string;
  createdAt: number;
}

interface ReminderFile {
  items: Reminder[];
}

export interface ReminderStore {
  readonly file: string;
  list(): Promise<Reminder[]>;
  add(text: string, dueAt: number, petId: string): Promise<Reminder>;
  remove(id: string): Promise<boolean>;
  takeDue(now: number): Promise<Reminder[]>;
}

export function createReminderStore(file: string): ReminderStore {
  let queue: Promise<void> = Promise.resolve();
  const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const read = async (): Promise<ReminderFile> => {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as ReminderFile;
      return { items: Array.isArray(parsed.items) ? parsed.items : [] };
    } catch {
      return { items: [] };
    }
  };
  const write = async (data: ReminderFile): Promise<void> => {
    await mkdir(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
    await rename(temp, file);
  };
  return {
    file,
    async list() {
      return (await read()).items.sort((a, b) => a.dueAt - b.dueAt);
    },
    async add(text, dueAt, petId) {
      return withLock(async () => {
        const data = await read();
        const item: Reminder = {
          id: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          text,
          dueAt,
          petId,
          createdAt: Date.now(),
        };
        data.items.push(item);
        await write(data);
        return item;
      });
    },
    async remove(id) {
      return withLock(async () => {
        const data = await read();
        const before = data.items.length;
        data.items = data.items.filter((item) => item.id !== id);
        if (data.items.length === before) return false;
        await write(data);
        return true;
      });
    },
    async takeDue(now) {
      return withLock(async () => {
        const data = await read();
        const due = data.items.filter((item) => item.dueAt <= now);
        if (due.length === 0) return [];
        data.items = data.items.filter((item) => item.dueAt > now);
        await write(data);
        return due;
      });
    },
  };
}
