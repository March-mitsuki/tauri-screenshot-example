export class Signal<T> {
  protected _listeners: Array<(data: T) => void> = [];

  subscribe(listener: (data: T) => void) {
    this._listeners.push(listener);
  }

  unsubscribe(listener: (data: T) => void) {
    this._listeners = this._listeners.filter((l) => l !== listener);
  }

  emit(data: T) {
    this._listeners.forEach((listener) => listener(data));
  }
}
