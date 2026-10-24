// Stands in for `claude -p` in tests (TANDEM_CLAUDE): answers like a Claude Code that is not
// logged in, with no Claude call.
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'result', is_error: true, result: 'Invalid API key · Please run /login', total_cost_usd: 0 }));
  process.exit(1);
});
