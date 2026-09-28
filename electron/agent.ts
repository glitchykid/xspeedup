import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { Method, RequestMap, ResponseMap } from '../shared/contracts';

export class Agent {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<
    string,
    { resolve: (data: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }
  >();
  constructor(private readonly executable: string) {}
  private start() {
    const child = spawn(this.executable, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        const message = JSON.parse(line) as {
          id: string;
          ok: boolean;
          data?: unknown;
          error?: string;
        };
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.data);
        else pending.reject(new Error(message.error || 'Ошибка Windows-компонента.'));
      } catch {
        this.stop(new Error('Windows-компонент вернул повреждённый ответ.'));
      }
    });
    child.stderr.on('data', () => {
      /* Drain diagnostics without exposing user paths to renderer logs. */
    });
    child.on('error', () =>
      this.stop(new Error('Не удалось запустить Windows-компонент. Выполните сборку приложения.')),
    );
    child.stdin.on('error', () =>
      this.stop(new Error('Соединение с Windows-компонентом прервано.')),
    );
    child.on('exit', () => {
      lines.close();
      if (this.child === child)
        this.stop(
          new Error(
            'Windows-компонент завершился. Повторите анализ; проверьте журнал выполненных действий.',
          ),
        );
    });
  }
  request<M extends Method>(method: M, args: RequestMap[M]): Promise<ResponseMap[M]> {
    if (!this.child) this.start();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(
        () =>
          this.stop(
            new Error(
              'Время ожидания истекло. Операция могла выполниться частично: проверьте журнал и повторите анализ.',
            ),
          ),
        120_000,
      );
      this.pending.set(id, { resolve: (data) => resolve(data as ResponseMap[M]), reject, timer });
      this.child!.stdin.write(JSON.stringify({ id, method, args }) + '\n');
    });
  }
  stop(error = new Error('Приложение закрыто.')) {
    const child = this.child;
    this.child = null;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
    child?.kill();
  }
}
