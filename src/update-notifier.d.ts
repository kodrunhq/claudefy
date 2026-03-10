declare module "update-notifier" {
  interface Options {
    pkg: { name: string; version: string };
    updateCheckInterval?: number;
  }
  interface Notifier {
    notify(options?: { defer?: boolean; message?: string }): void;
  }
  export default function updateNotifier(options: Options): Notifier;
}
