// src/ai/educate.js
export function educateText() {
  return [
    'Choosing your AI model — what each is GOOD at, what it costs, how to set it up.',
    '',
    '  lite (default)  — cheap & fast. Great for "what does this mean", quick explainers.',
    '                   Still smart, just shallower. Set: AI_PROVIDER=anthropic + AI_API_KEY',
    '  pro             — most capable. Deep reasoning, hard bugs, refactors. Costs more.',
    '                   Set: AI_PROVIDER=anthropic + AI_MODEL=<pro model>',
    '  local (Ollama)  — free, private, offline. Good enough for summaries and small asks.',
    '                   Set: AI_PROVIDER=ollama (runs entirely on your machine)',
    '  Claude Code     — not just chat: a full agent that can READ AND EDIT your files',
    '                   and run commands. Use it when you want the AI to DO things,',
    '                   not just talk. Set: AI_PROVIDER=claude-code (no key needed)',
    '',
    'Try this: for a one-line "what does this mean" question, lite or local is plenty —',
    'you do not need the expensive model. That choice is exactly what vibe-coders are',
    'never taught; now you know it in 30 seconds.',
    'Setup is a 2-line edit in .env (see .env.example). Every AI answer shows the model,',
    'token count and approx cost, so you always know the price before you commit.',
  ].join('\n');
}
