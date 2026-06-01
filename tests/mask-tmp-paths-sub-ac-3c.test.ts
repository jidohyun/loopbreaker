/**
 * tests/mask-tmp-paths-sub-ac-3c.test.ts
 *
 * Sub-AC 3c: maskTmpPaths(arg: string): string 단위 테스트
 *
 * 검증 범위:
 *   - /tmp/... 패턴 (Linux/macOS 표준)
 *   - /var/folders/... 패턴 (macOS os.TempDir())
 *   - /var/tmp/... 패턴 (Linux/macOS 대체 임시)
 *   - Windows AppData\Local\Temp\... 패턴 (백슬래시/슬래시)
 *   - 경로가 포함된 혼합 명령어
 *   - 비임시 경로 보존
 *   - 결정론성 및 순수함수 검증
 *   - _internal 노출 확인
 */

import { maskTmpPaths, _internal } from '../src/detect/triple-builder.js'

// ─── /tmp/... 패턴 ────────────────────────────────────────────────

describe('maskTmpPaths — /tmp/... 패턴', () => {
  it('/tmp/file.txt 를 마스킹한다', () => {
    expect(maskTmpPaths('/tmp/file.txt')).toBe('<TMP_PATH>')
  })

  it('/tmp/abc123 를 마스킹한다', () => {
    expect(maskTmpPaths('/tmp/abc123')).toBe('<TMP_PATH>')
  })

  it('/tmp/subdir/file.log 를 마스킹한다', () => {
    expect(maskTmpPaths('/tmp/subdir/file.log')).toBe('<TMP_PATH>')
  })

  it('/tmp/deep/nested/path/file.ts 를 마스킹한다', () => {
    expect(maskTmpPaths('/tmp/deep/nested/path/file.ts')).toBe('<TMP_PATH>')
  })

  it('명령어 내 /tmp 경로를 마스킹한다', () => {
    const result = maskTmpPaths('cat /tmp/output.txt')
    expect(result).toBe('cat <TMP_PATH>')
  })

  it('명령어 중간의 /tmp 경로를 마스킹한다', () => {
    const result = maskTmpPaths('cp /tmp/source.sh /home/user/dest.sh')
    expect(result).toBe('cp <TMP_PATH> /home/user/dest.sh')
  })

  it('여러 /tmp 경로를 모두 마스킹한다', () => {
    const result = maskTmpPaths('cp /tmp/src.txt /tmp/dst.txt')
    expect(result).toBe('cp <TMP_PATH> <TMP_PATH>')
  })

  it('/tmp/만 있고 뒤에 경로가 없으면 보존된다', () => {
    // /tmp 자체(슬래시 없이)는 패턴 미해당
    expect(maskTmpPaths('/tmp')).toBe('/tmp')
  })
})

// ─── /var/folders/... 패턴 (macOS os.TempDir()) ───────────────────

describe('maskTmpPaths — /var/folders/... 패턴', () => {
  it('/var/folders/xx/abc123/T/ 를 마스킹한다', () => {
    expect(maskTmpPaths('/var/folders/xx/abc123/T/')).toBe('<TMP_PATH>')
  })

  it('macOS os.TempDir() 형식 전체 경로를 마스킹한다', () => {
    const path = '/var/folders/xx/abc1def2ghi3/T/tmp-file-12345'
    expect(maskTmpPaths(path)).toBe('<TMP_PATH>')
  })

  it('명령어 내 /var/folders 경로를 마스킹한다', () => {
    const result = maskTmpPaths('ls /var/folders/xx/abc/T/tmpfile')
    expect(result).toBe('ls <TMP_PATH>')
  })

  it('여러 /var/folders 경로를 모두 마스킹한다', () => {
    const result = maskTmpPaths(
      'diff /var/folders/xx/abc/T/old.txt /var/folders/xx/abc/T/new.txt',
    )
    expect(result).toBe('diff <TMP_PATH> <TMP_PATH>')
  })

  it('/var/folders/xx/abc/T/nested/deep/file 를 마스킹한다', () => {
    expect(maskTmpPaths('/var/folders/xx/abc/T/nested/deep/file')).toBe('<TMP_PATH>')
  })
})

// ─── /var/tmp/... 패턴 ────────────────────────────────────────────

describe('maskTmpPaths — /var/tmp/... 패턴', () => {
  it('/var/tmp/somefile.txt 를 마스킹한다', () => {
    expect(maskTmpPaths('/var/tmp/somefile.txt')).toBe('<TMP_PATH>')
  })

  it('/var/tmp/subdir/file.log 를 마스킹한다', () => {
    expect(maskTmpPaths('/var/tmp/subdir/file.log')).toBe('<TMP_PATH>')
  })

  it('명령어 내 /var/tmp 경로를 마스킹한다', () => {
    const result = maskTmpPaths('rm -f /var/tmp/lock.pid')
    expect(result).toBe('rm -f <TMP_PATH>')
  })
})

// ─── Windows AppData\Local\Temp 패턴 ─────────────────────────────

describe('maskTmpPaths — Windows AppData\\Local\\Temp 패턴', () => {
  it('Windows 백슬래시 임시 경로를 마스킹한다', () => {
    const path = 'C:\\Users\\user\\AppData\\Local\\Temp\\file.txt'
    expect(maskTmpPaths(path)).toBe('<TMP_PATH>')
  })

  it('Windows 슬래시 임시 경로를 마스킹한다', () => {
    const path = 'C:/Users/user/AppData/Local/Temp/tmpfile.log'
    expect(maskTmpPaths(path)).toBe('<TMP_PATH>')
  })

  it('명령어 내 Windows Temp 경로를 마스킹한다', () => {
    const result = maskTmpPaths('type C:\\Users\\john\\AppData\\Local\\Temp\\out.txt')
    expect(result).toBe('type <TMP_PATH>')
  })

  it('다른 드라이브 문자를 지원한다', () => {
    const path = 'D:\\Users\\user\\AppData\\Local\\Temp\\session.tmp'
    expect(maskTmpPaths(path)).toBe('<TMP_PATH>')
  })
})

// ─── 비임시 경로 보존 ─────────────────────────────────────────────

describe('maskTmpPaths — 비임시 경로 보존', () => {
  it('/home/user/file.txt 를 변경하지 않는다', () => {
    const path = '/home/user/file.txt'
    expect(maskTmpPaths(path)).toBe(path)
  })

  it('/usr/local/bin/node 를 변경하지 않는다', () => {
    const path = '/usr/local/bin/node'
    expect(maskTmpPaths(path)).toBe(path)
  })

  it('/project/src/index.ts 를 변경하지 않는다', () => {
    const path = '/project/src/index.ts'
    expect(maskTmpPaths(path)).toBe(path)
  })

  it('/var/log/syslog 를 변경하지 않는다 (/var/log는 tmp 아님)', () => {
    const path = '/var/log/syslog'
    expect(maskTmpPaths(path)).toBe(path)
  })

  it('/var/run/app.pid 를 변경하지 않는다 (/var/run은 tmp 아님)', () => {
    const path = '/var/run/app.pid'
    expect(maskTmpPaths(path)).toBe(path)
  })

  it('일반 텍스트를 변경하지 않는다', () => {
    expect(maskTmpPaths('hello world')).toBe('hello world')
  })

  it('빈 문자열을 변경하지 않는다', () => {
    expect(maskTmpPaths('')).toBe('')
  })

  it('숫자만 있는 문자열을 변경하지 않는다', () => {
    expect(maskTmpPaths('12345')).toBe('12345')
  })

  it('C:\\Program Files\\app.exe 를 변경하지 않는다', () => {
    const path = 'C:\\Program Files\\app.exe'
    expect(maskTmpPaths(path)).toBe(path)
  })
})

// ─── 혼합 패턴 ────────────────────────────────────────────────────

describe('maskTmpPaths — 혼합 패턴', () => {
  it('tmp 경로와 일반 경로가 혼재할 때 tmp만 마스킹한다', () => {
    const result = maskTmpPaths('cp /tmp/input.json /project/output.json')
    expect(result).toBe('cp <TMP_PATH> /project/output.json')
  })

  it('/tmp와 /var/folders가 함께 있으면 모두 마스킹한다', () => {
    const result = maskTmpPaths(
      'diff /tmp/old.txt /var/folders/xx/abc/T/new.txt',
    )
    expect(result).toBe('diff <TMP_PATH> <TMP_PATH>')
  })

  it('긴 Bash 명령어 안의 tmp 경로를 마스킹한다', () => {
    const cmd = 'node --require /tmp/setup.js /project/src/index.js --output /tmp/result.json'
    const result = maskTmpPaths(cmd)
    expect(result).toBe('node --require <TMP_PATH> /project/src/index.js --output <TMP_PATH>')
  })

  it('타임스탬프 suffix가 있는 tmp 경로를 마스킹한다', () => {
    // /tmp/file-1705312245.tmp 형태
    const result = maskTmpPaths('cat /tmp/session-1705312245.json')
    expect(result).toBe('cat <TMP_PATH>')
  })

  it('tmp 경로가 없는 명령어를 그대로 반환한다', () => {
    const cmd = 'git status --short'
    expect(maskTmpPaths(cmd)).toBe(cmd)
  })
})

// ─── 결정론성 ─────────────────────────────────────────────────────

describe('maskTmpPaths — 결정론성', () => {
  it('동일 입력은 항상 동일 출력을 반환한다', () => {
    const input = 'cat /tmp/output.txt /var/folders/xx/T/tmp.log'
    expect(maskTmpPaths(input)).toBe(maskTmpPaths(input))
  })

  it('입력 문자열을 변경하지 않는다 (순수함수)', () => {
    const input = '/tmp/file.txt'
    const original = input
    maskTmpPaths(input)
    expect(input).toBe(original)
  })

  it('여러 번 호출해도 동일한 결과를 반환한다', () => {
    const input = '/var/folders/xx/abc/T/tmpfile'
    const first = maskTmpPaths(input)
    const second = maskTmpPaths(input)
    const third = maskTmpPaths(input)
    expect(first).toBe(second)
    expect(second).toBe(third)
  })

  it('멱등성: 이미 마스킹된 문자열을 다시 마스킹해도 변하지 않는다', () => {
    // <TMP_PATH>는 /tmp/나 /var/folders/ 패턴에 해당하지 않음
    const once = maskTmpPaths('/tmp/file.txt')
    const twice = maskTmpPaths(once)
    expect(once).toBe(twice)
  })
})

// ─── _internal 노출 확인 ──────────────────────────────────────────

describe('maskTmpPaths — _internal 노출', () => {
  it('_internal에 maskTmpPaths가 존재한다', () => {
    expect(typeof _internal.maskTmpPaths).toBe('function')
  })

  it('_internal.maskTmpPaths는 top-level maskTmpPaths와 동일하다', () => {
    const input = '/tmp/file.txt'
    expect(_internal.maskTmpPaths(input)).toBe(maskTmpPaths(input))
  })

  it('_internal.maskTmpPaths도 동일한 결과를 반환한다', () => {
    expect(_internal.maskTmpPaths('/var/folders/xx/abc/T/tmp')).toBe('<TMP_PATH>')
  })
})
