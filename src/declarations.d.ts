declare module "lucide-react";
declare module "x-client-transaction-id";
declare module "hls.js" {
  export default class Hls {
    static isSupported(): boolean;
    static Events: Record<string, string>;
    constructor(config?: any);
    destroy(): void;
    loadSource(url: string): void;
    attachMedia(media: HTMLMediaElement): void;
    on(event: string, callback: (...args: any[]) => void): void;
  }
}
