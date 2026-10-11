// A trusted Node test reporter: assertion failures count as reproduction evidence;
// syntax errors, missing imports, killed processes, and runner errors do not.
export default async function* reporter(events) {
  const result = { passed: 0, assertions: 0, errors: 0, skipped: 0 };
  for await (const event of events) {
    if (event.type === 'test:pass') {
      if (event.data.skip || event.data.todo) result.skipped++;
      else result.passed++;
    }
    if (event.type === 'test:fail') {
      const error = event.data.details.error;
      if (error?.cause?.code === 'ERR_ASSERTION' || error?.code === 'ERR_ASSERTION') result.assertions++;
      else if (error?.failureType !== 'subtestsFailed') result.errors++;
    }
  }
  yield JSON.stringify(result);
}

