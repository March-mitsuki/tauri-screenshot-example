export class State<T> {
  protected _state: T;
  protected _listeners: Array<(state: T) => void>;

  constructor(initialState: T) {
    this._state = initialState;
    this._listeners = [];
  }

  get data(): T {
    return this._state;
  }

  subscribe(listener: (state: T) => void) {
    this._listeners.push(listener);
  }

  unsubscribe(listener: (state: T) => void) {
    this._listeners = this._listeners.filter((l) => l !== listener);
  }

  setState(newState: T): void;
  setState(newState: (prevState: T) => T): void;
  setState(setter: T | ((prevState: T) => T)) {
    if (setter instanceof Function) {
      this._state = setter(this._state);
    } else {
      this._state = setter;
    }
    this._listeners.forEach((listener) => listener(this._state));
  }
}
