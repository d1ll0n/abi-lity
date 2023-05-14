/* eslint-disable @typescript-eslint/ban-types */
import EventEmitter from "events";

export type EventMap = Record<PropertyKey, unknown>;

/**
 * @author G-Rath
 * https://github.com/G-Rath/strongly-typed-event-emitter
 */
export declare class StronglyTypedEventEmitter<TEventMap extends EventMap> extends EventEmitter {
  /** @deprecated since v4.0.0 */
  public static listenerCount(emitter: EventEmitter, event: keyof PropertyKey): number;

  public addListener<K extends keyof TEventMap>(
    event: K,
    listener: (event: TEventMap[K]) => void
  ): this;

  public on<K extends keyof TEventMap>(event: K, listener: (event: TEventMap[K]) => void): this;

  public once<K extends keyof TEventMap>(event: K, listener: (event: TEventMap[K]) => void): this;

  public prependListener<K extends keyof TEventMap>(
    event: K,
    listener: (event: TEventMap[K]) => void
  ): this;

  public prependOnceListener<K extends keyof TEventMap>(
    event: K,
    listener: (event: TEventMap[K]) => void
  ): this;

  public removeListener<K extends keyof TEventMap>(
    event: K,
    listener: (event: TEventMap[K]) => void
  ): this;

  public off<K extends keyof TEventMap>(event: K, listener: (event: TEventMap[K]) => void): this;

  public removeAllListeners(event?: keyof TEventMap): this;

  public setMaxListeners(n: number): this;

  public getMaxListeners(): number;

  public listeners<K extends keyof TEventMap>(
    event: K
  ): Array<((event: TEventMap[K]) => void) | Function>;

  public rawListeners<K extends keyof TEventMap>(
    event: K
  ): Array<((event: TEventMap[K]) => void) | Function>;

  public emit<K extends keyof TEventMap>(event: K, data: TEventMap[K]): boolean;

  public eventNames(): Array<string | symbol>;

  public listenerCount(type: keyof TEventMap): number;
}
