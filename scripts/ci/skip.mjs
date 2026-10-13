export function skip(reason) {
  console.log(`\n>>> SKIP: ${reason}\n`);
  process.exit(0);
}

export function fail(message) {
  console.error(`\n>>> FAIL: ${message}\n`);
  process.exit(1);
}

export async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
