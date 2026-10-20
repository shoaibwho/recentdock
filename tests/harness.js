// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal test harness for GJS (no dependencies).

const tests = [];
export function test(name, fn) {
    tests.push({name, fn});
}

export function assertEqual(actual, expected, msg = '') {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

export function assert(cond, msg = 'assertion failed') {
    if (!cond)
        throw new Error(msg);
}

export async function run() {
    let failed = 0;
    for (const t of tests) {
        try {
            await t.fn();
            print(`ok   ${t.name}`);
        } catch (e) {
            failed++;
            print(`FAIL ${t.name}\n  ${e.message}\n${e.stack?.split('\n').slice(0, 3).join('\n')}`);
        }
    }
    print(`\n${tests.length - failed}/${tests.length} passed`);
    return failed;
}
