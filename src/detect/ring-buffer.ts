/**
 * src/detect/ring-buffer.ts
 *
 * 고정 크기 RingBuffer (circular buffer) 자료구조.
 *
 * 설계 원칙:
 *   - 불변성: 외부에서 내부 배열을 변경할 수 없음 (읽기 전용 뷰 반환)
 *   - push 시 historySize 초과하면 가장 오래된 항목이 자동 제거됨
 *   - toArray()는 삽입 순서대로 현재 윈도 내 항목만 반환
 *   - LLM 호출 0, 결정론적
 *   - console.log 금지
 *
 * 사용 예:
 *   const buf = new RingBuffer<number>(3)
 *   buf.push(1) // [1]
 *   buf.push(2) // [1, 2]
 *   buf.push(3) // [1, 2, 3]
 *   buf.push(4) // [2, 3, 4]  ← oldest (1) evicted
 */

/** push 시 오래된 항목이 evict될 때 호출되는 콜백 타입 */
export type EvictCallback<T> = (evicted: T) => void

/**
 * 고정 크기 슬라이딩 윈도 RingBuffer.
 *
 * 내부적으로 head 포인터와 고정 크기 배열로 O(1) push/evict를 구현한다.
 * 외부에는 항상 삽입 순서(오래된 것 → 새것)로 정렬된 뷰를 제공한다.
 */
export class RingBuffer<T> {
  /** 내부 고정 크기 배열 */
  private readonly _buf: (T | undefined)[]
  /** 다음 쓰기 위치 (head) */
  private _head: number
  /** 현재 저장된 항목 수 */
  private _size: number
  /** evict 콜백 (선택) */
  private readonly _onEvict: EvictCallback<T> | undefined

  /**
   * @param capacity historySize — 최대 보관 항목 수. 1 이상 정수여야 함.
   * @param onEvict  항목이 evict될 때 호출할 콜백 (선택)
   * @throws {RangeError} capacity가 1 미만이면 RangeError 발생
   */
  constructor(capacity: number, onEvict?: EvictCallback<T>) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`RingBuffer capacity must be a positive integer, got: ${capacity}`)
    }
    this._buf = new Array<T | undefined>(capacity).fill(undefined)
    this._head = 0
    this._size = 0
    this._onEvict = onEvict
  }

  /** 최대 보관 가능한 항목 수 (historySize) */
  get capacity(): number {
    return this._buf.length
  }

  /** 현재 윈도 내 항목 수 */
  get size(): number {
    return this._size
  }

  /** 버퍼가 비었는지 여부 */
  get isEmpty(): boolean {
    return this._size === 0
  }

  /** 버퍼가 꽉 찼는지 여부 (capacity에 도달) */
  get isFull(): boolean {
    return this._size === this._buf.length
  }

  /**
   * 새 항목을 버퍼에 추가한다.
   *
   * - capacity 미만이면 단순 추가.
   * - capacity 초과 시 가장 오래된 항목을 evict하고 덮어쓴다.
   * - evict 콜백이 등록되어 있으면 evict된 항목으로 호출한다.
   *
   * @param item 추가할 항목
   * @returns evict된 항목 (없으면 undefined)
   */
  push(item: T): T | undefined {
    let evicted: T | undefined

    if (this._size === this._buf.length) {
      // 버퍼가 꽉 참 → oldest 항목(= head 위치)을 evict
      evicted = this._buf[this._head] as T
      if (this._onEvict !== undefined) {
        this._onEvict(evicted)
      }
      // head를 덮어쓰고 head 전진
      this._buf[this._head] = item
      this._head = (this._head + 1) % this._buf.length
    } else {
      // 아직 자리 있음 → (head + size) 위치에 쓰기
      const writePos = (this._head + this._size) % this._buf.length
      this._buf[writePos] = item
      this._size++
    }

    return evicted
  }

  /**
   * 현재 윈도 내 모든 항목을 삽입 순서(오래된 것 → 새것)로 반환한다.
   *
   * 반환된 배열은 내부 버퍼의 복사본이므로 외부 변경이 내부에 영향을 미치지 않는다.
   */
  toArray(): T[] {
    if (this._size === 0) return []
    const result: T[] = []
    for (let i = 0; i < this._size; i++) {
      const idx = (this._head + i) % this._buf.length
      result.push(this._buf[idx] as T)
    }
    return result
  }

  /**
   * 현재 윈도 내 항목을 삽입 순서로 순회한다.
   * 이터레이터 프로토콜 구현 — for...of 사용 가능.
   */
  [Symbol.iterator](): Iterator<T> {
    const arr = this.toArray()
    let idx = 0
    return {
      next(): IteratorResult<T> {
        if (idx < arr.length) {
          return { value: arr[idx++]!, done: false }
        }
        return { value: undefined as unknown as T, done: true }
      },
    }
  }

  /**
   * 버퍼를 초기화한다 (모든 항목 제거, head/size 리셋).
   * evict 콜백은 호출되지 않는다.
   */
  clear(): void {
    this._buf.fill(undefined)
    this._head = 0
    this._size = 0
  }

  /**
   * 조건을 만족하는 항목 수를 반환한다.
   * 현재 윈도 내에서만 카운트한다.
   */
  countWhere(predicate: (item: T) => boolean): number {
    let count = 0
    for (let i = 0; i < this._size; i++) {
      const idx = (this._head + i) % this._buf.length
      if (predicate(this._buf[idx] as T)) count++
    }
    return count
  }

  /**
   * 조건을 만족하는 항목들을 반환한다.
   * 삽입 순서 유지.
   */
  filterWhere(predicate: (item: T) => boolean): T[] {
    const result: T[] = []
    for (let i = 0; i < this._size; i++) {
      const idx = (this._head + i) % this._buf.length
      const item = this._buf[idx] as T
      if (predicate(item)) result.push(item)
    }
    return result
  }
}
