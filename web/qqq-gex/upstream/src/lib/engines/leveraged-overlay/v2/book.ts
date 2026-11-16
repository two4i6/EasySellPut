/** 迁移期间保持数组迭代语义的策略仓位账本；策略逐步改用 add/removeAt。 */
export class OverlayBook<T> extends Array<T> {
  static get [Symbol.species](): ArrayConstructor { return Array; }

  add(position: T): void { this.push(position); }

  removeAt(index: number): T | undefined {
    return index >= 0 ? this.splice(index, 1)[0] : undefined;
  }

  drain(): T[] { return this.splice(0); }
}
