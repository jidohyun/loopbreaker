/**
 * tests/ring-buffer.test.ts
 *
 * RingBuffer 단위 테스트 — Sub-AC 1
 *
 * 검증 항목:
 *   - 기본 push/toArray 동작
 *   - historySize 이하에서 evict 없음
 *   - capacity 초과 시 oldest 항목 자동 제거 (슬라이딩 윈도)
 *   - 현재 윈도 내 항목만 반환 (evict된 항목 미포함)
 *   - size/isEmpty/isFull 상태 추적
 *   - evict 콜백 호출
 *   - clear() 동작
 *   - capacity=1 엣지케이스
 *   - 이터레이터 (for...of)
 *   - countWhere / filterWhere
 *   - 잘못된 capacity에 대한 RangeError
 *   - toArray()가 내부 배열 복사본임을 검증
 */

import { RingBuffer } from '../src/detect/ring-buffer.js'

// ─── 기본 동작 ────────────────────────────────────────────────

describe('RingBuffer — 기본 동작', () => {
  test('빈 버퍼: size=0, isEmpty=true, isFull=false, toArray=[]', () => {
    const buf = new RingBuffer<number>(3)
    expect(buf.size).toBe(0)
    expect(buf.isEmpty).toBe(true)
    expect(buf.isFull).toBe(false)
    expect(buf.toArray()).toEqual([])
  })

  test('capacity 반환', () => {
    const buf = new RingBuffer<string>(5)
    expect(buf.capacity).toBe(5)
  })

  test('단일 push: size=1, isEmpty=false', () => {
    const buf = new RingBuffer<number>(3)
    const evicted = buf.push(42)
    expect(evicted).toBeUndefined()
    expect(buf.size).toBe(1)
    expect(buf.isEmpty).toBe(false)
    expect(buf.toArray()).toEqual([42])
  })

  test('capacity 미만 push: 순서대로 toArray 반환', () => {
    const buf = new RingBuffer<number>(5)
    buf.push(1)
    buf.push(2)
    buf.push(3)
    expect(buf.toArray()).toEqual([1, 2, 3])
    expect(buf.size).toBe(3)
    expect(buf.isFull).toBe(false)
  })

  test('capacity 정확히 채움: isFull=true, toArray 순서 유지', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(10)
    buf.push(20)
    buf.push(30)
    expect(buf.isFull).toBe(true)
    expect(buf.size).toBe(3)
    expect(buf.toArray()).toEqual([10, 20, 30])
  })
})

// ─── 슬라이딩 윈도 (evict) ────────────────────────────────────

describe('RingBuffer — 슬라이딩 윈도 (evict)', () => {
  test('capacity 초과 시 oldest 항목이 evict됨', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(1)
    buf.push(2)
    buf.push(3)
    const evicted = buf.push(4) // 1이 evict되어야 함
    expect(evicted).toBe(1)
    expect(buf.toArray()).toEqual([2, 3, 4])
    expect(buf.size).toBe(3)
  })

  test('연속 push로 윈도가 올바르게 슬라이딩함', () => {
    const buf = new RingBuffer<number>(3)
    for (let i = 1; i <= 7; i++) buf.push(i)
    // 마지막 3개(5, 6, 7)만 남아야 함
    expect(buf.toArray()).toEqual([5, 6, 7])
    expect(buf.size).toBe(3)
  })

  test('evict된 항목은 toArray에 포함되지 않음', () => {
    const buf = new RingBuffer<string>(2)
    buf.push('a')
    buf.push('b')
    buf.push('c') // 'a' evict
    const arr = buf.toArray()
    expect(arr).not.toContain('a')
    expect(arr).toEqual(['b', 'c'])
  })

  test('capacity=1: 항상 최신 항목 1개만 보관', () => {
    const buf = new RingBuffer<number>(1)
    buf.push(100)
    expect(buf.toArray()).toEqual([100])
    const e1 = buf.push(200)
    expect(e1).toBe(100)
    expect(buf.toArray()).toEqual([200])
    const e2 = buf.push(300)
    expect(e2).toBe(200)
    expect(buf.toArray()).toEqual([300])
    expect(buf.size).toBe(1)
  })

  test('historySize번 push 후 정확히 historySize개만 윈도에 존재', () => {
    const historySize = 30
    const buf = new RingBuffer<number>(historySize)
    for (let i = 0; i < historySize + 5; i++) buf.push(i)
    expect(buf.size).toBe(historySize)
    expect(buf.toArray()).toHaveLength(historySize)
    // 윈도 = [5, 6, ..., 34]
    const arr = buf.toArray()
    expect(arr[0]).toBe(5)
    expect(arr[historySize - 1]).toBe(34)
  })

  test('capacity=T: T번 push 시 isFull, T+1번째에 evict', () => {
    const T = 5
    const buf = new RingBuffer<number>(T)
    for (let i = 0; i < T; i++) buf.push(i)
    expect(buf.isFull).toBe(true)
    const evicted = buf.push(99)
    expect(evicted).toBe(0)
    expect(buf.size).toBe(T)
  })
})

// ─── evict 콜백 ──────────────────────────────────────────────

describe('RingBuffer — evict 콜백', () => {
  test('capacity 미만 push 시 콜백 호출 없음', () => {
    const evictedItems: number[] = []
    const buf = new RingBuffer<number>(3, item => evictedItems.push(item))
    buf.push(1)
    buf.push(2)
    expect(evictedItems).toEqual([])
  })

  test('capacity 초과 push 시 콜백이 evict된 항목으로 호출됨', () => {
    const evictedItems: number[] = []
    const buf = new RingBuffer<number>(3, item => evictedItems.push(item))
    buf.push(1)
    buf.push(2)
    buf.push(3)
    buf.push(4) // 1 evict
    buf.push(5) // 2 evict
    expect(evictedItems).toEqual([1, 2])
  })

  test('콜백이 evict 순서대로 호출됨 (oldest first)', () => {
    const order: string[] = []
    const buf = new RingBuffer<string>(2, item => order.push(item))
    buf.push('A')
    buf.push('B')
    buf.push('C') // A evict
    buf.push('D') // B evict
    buf.push('E') // C evict
    expect(order).toEqual(['A', 'B', 'C'])
  })

  test('콜백 없이 생성된 버퍼는 에러 없이 evict 처리', () => {
    const buf = new RingBuffer<number>(2)
    buf.push(1)
    buf.push(2)
    expect(() => buf.push(3)).not.toThrow()
    expect(buf.toArray()).toEqual([2, 3])
  })
})

// ─── clear() ─────────────────────────────────────────────────

describe('RingBuffer — clear()', () => {
  test('clear 후 size=0, isEmpty=true, toArray=[]', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(1)
    buf.push(2)
    buf.push(3)
    buf.clear()
    expect(buf.size).toBe(0)
    expect(buf.isEmpty).toBe(true)
    expect(buf.toArray()).toEqual([])
  })

  test('clear 후 다시 push 가능', () => {
    const buf = new RingBuffer<string>(3)
    buf.push('x')
    buf.push('y')
    buf.clear()
    buf.push('a')
    buf.push('b')
    expect(buf.toArray()).toEqual(['a', 'b'])
    expect(buf.size).toBe(2)
  })

  test('clear는 evict 콜백을 호출하지 않음', () => {
    const evictedItems: number[] = []
    const buf = new RingBuffer<number>(3, item => evictedItems.push(item))
    buf.push(1)
    buf.push(2)
    buf.push(3)
    buf.clear()
    expect(evictedItems).toEqual([])
  })
})

// ─── 이터레이터 ───────────────────────────────────────────────

describe('RingBuffer — 이터레이터 (for...of)', () => {
  test('for...of로 삽입 순서 순회', () => {
    const buf = new RingBuffer<number>(5)
    buf.push(10)
    buf.push(20)
    buf.push(30)
    const collected: number[] = []
    for (const item of buf) collected.push(item)
    expect(collected).toEqual([10, 20, 30])
  })

  test('슬라이딩 윈도 후 이터레이터는 현재 윈도만 순회', () => {
    const buf = new RingBuffer<number>(3)
    for (let i = 1; i <= 5; i++) buf.push(i)
    const collected: number[] = []
    for (const item of buf) collected.push(item)
    expect(collected).toEqual([3, 4, 5])
  })

  test('빈 버퍼 이터레이터: 순회 항목 없음', () => {
    const buf = new RingBuffer<number>(3)
    const collected: number[] = []
    for (const item of buf) collected.push(item)
    expect(collected).toEqual([])
  })
})

// ─── countWhere / filterWhere ─────────────────────────────────

describe('RingBuffer — countWhere / filterWhere', () => {
  test('countWhere: 조건 만족 항목 수 반환', () => {
    const buf = new RingBuffer<number>(5)
    buf.push(1)
    buf.push(2)
    buf.push(3)
    buf.push(4)
    expect(buf.countWhere(n => n % 2 === 0)).toBe(2)
    expect(buf.countWhere(n => n > 10)).toBe(0)
    expect(buf.countWhere(() => true)).toBe(4)
  })

  test('countWhere: evict된 항목은 카운트 제외', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(2) // will be evicted
    buf.push(4)
    buf.push(6)
    buf.push(8) // 2 evicted
    // window: [4, 6, 8] — 2 is gone
    expect(buf.countWhere(n => n % 2 === 0)).toBe(3)
    expect(buf.countWhere(n => n === 2)).toBe(0)
  })

  test('filterWhere: 조건 만족 항목 배열 반환 (순서 유지)', () => {
    const buf = new RingBuffer<number>(5)
    buf.push(1)
    buf.push(2)
    buf.push(3)
    buf.push(4)
    buf.push(5)
    expect(buf.filterWhere(n => n % 2 !== 0)).toEqual([1, 3, 5])
  })

  test('filterWhere: 매칭 없으면 빈 배열', () => {
    const buf = new RingBuffer<string>(3)
    buf.push('hello')
    buf.push('world')
    expect(buf.filterWhere(s => s.includes('xyz'))).toEqual([])
  })

  test('빈 버퍼: countWhere=0, filterWhere=[]', () => {
    const buf = new RingBuffer<number>(5)
    expect(buf.countWhere(() => true)).toBe(0)
    expect(buf.filterWhere(() => true)).toEqual([])
  })
})

// ─── toArray() 불변성 ─────────────────────────────────────────

describe('RingBuffer — toArray() 불변성', () => {
  test('toArray() 반환 배열을 변경해도 내부 버퍼에 영향 없음', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(1)
    buf.push(2)
    const arr = buf.toArray()
    arr.push(999)      // 외부 배열 변경
    arr[0] = -1        // 외부 배열 변경
    // 내부는 변경되지 않아야 함
    expect(buf.toArray()).toEqual([1, 2])
    expect(buf.size).toBe(2)
  })

  test('연속 toArray() 호출마다 독립적인 배열 반환', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(10)
    buf.push(20)
    const arr1 = buf.toArray()
    const arr2 = buf.toArray()
    expect(arr1).not.toBe(arr2) // 다른 참조
    expect(arr1).toEqual(arr2)   // 같은 내용
  })
})

// ─── 잘못된 capacity ──────────────────────────────────────────

describe('RingBuffer — 잘못된 capacity 에러 처리', () => {
  test('capacity=0이면 RangeError 발생', () => {
    expect(() => new RingBuffer<number>(0)).toThrow(RangeError)
  })

  test('capacity<0이면 RangeError 발생', () => {
    expect(() => new RingBuffer<number>(-1)).toThrow(RangeError)
  })

  test('capacity가 소수이면 RangeError 발생', () => {
    expect(() => new RingBuffer<number>(2.5)).toThrow(RangeError)
  })

  test('capacity=1은 유효함 (RangeError 없음)', () => {
    expect(() => new RingBuffer<number>(1)).not.toThrow()
  })
})

// ─── 객체 타입 아이템 ─────────────────────────────────────────

describe('RingBuffer — 객체 타입 아이템', () => {
  interface Item {
    id: number
    label: string
  }

  test('객체 타입으로 push/toArray 동작', () => {
    const buf = new RingBuffer<Item>(2)
    buf.push({ id: 1, label: 'a' })
    buf.push({ id: 2, label: 'b' })
    buf.push({ id: 3, label: 'c' }) // {id:1} evicted
    const arr = buf.toArray()
    expect(arr).toHaveLength(2)
    expect(arr[0]).toEqual({ id: 2, label: 'b' })
    expect(arr[1]).toEqual({ id: 3, label: 'c' })
  })

  test('filterWhere로 객체 필드 기반 필터링', () => {
    const buf = new RingBuffer<Item>(5)
    buf.push({ id: 1, label: 'foo' })
    buf.push({ id: 2, label: 'bar' })
    buf.push({ id: 3, label: 'foo' })
    const foos = buf.filterWhere(item => item.label === 'foo')
    expect(foos).toHaveLength(2)
    expect(foos.map(i => i.id)).toEqual([1, 3])
  })

  test('evict 콜백이 올바른 객체를 수신', () => {
    const evicted: Item[] = []
    const buf = new RingBuffer<Item>(2, item => evicted.push(item))
    buf.push({ id: 1, label: 'first' })
    buf.push({ id: 2, label: 'second' })
    buf.push({ id: 3, label: 'third' }) // {id:1} evicted
    expect(evicted).toHaveLength(1)
    expect(evicted[0]).toEqual({ id: 1, label: 'first' })
  })
})

// ─── 대용량 / 경계값 ─────────────────────────────────────────

describe('RingBuffer — 대용량 / 경계값', () => {
  test('historySize=30인 경우 30번 push 후 정확히 30개', () => {
    const buf = new RingBuffer<number>(30)
    for (let i = 0; i < 30; i++) buf.push(i)
    expect(buf.size).toBe(30)
    expect(buf.isFull).toBe(true)
  })

  test('historySize=30에서 100번 push 후 최근 30개만 존재', () => {
    const buf = new RingBuffer<number>(30)
    for (let i = 0; i < 100; i++) buf.push(i)
    expect(buf.size).toBe(30)
    const arr = buf.toArray()
    expect(arr[0]).toBe(70)
    expect(arr[29]).toBe(99)
  })

  test('push 반환값: evict 없으면 undefined, evict 있으면 evicted item', () => {
    const buf = new RingBuffer<string>(2)
    expect(buf.push('A')).toBeUndefined()
    expect(buf.push('B')).toBeUndefined()
    expect(buf.push('C')).toBe('A')
    expect(buf.push('D')).toBe('B')
  })
})
