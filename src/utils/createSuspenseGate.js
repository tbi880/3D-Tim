// A manually-resolvable "resource" for Suspense.
// While pending, reading it throws a promise, so any Suspense
// boundary it's read inside keeps showing its fallback.
export function createSuspenseGate() {
    let status = 'pending';
    let resolveFn;
    const promise = new Promise((res) => { resolveFn = res; });

    return {
        resolve() {
            if (status === 'pending') {
                status = 'done';
                resolveFn();
            }
        },
        read() {
            if (status === 'pending') throw promise;
        },
    };
}

export function SuspenseGate({ gate }) {
    gate.read(); // throws while pending — this is what holds Suspense open
    return null;
}