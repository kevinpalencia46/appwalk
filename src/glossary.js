// src/glossary.js
const T = (term, what, why, when) => ({ term, what, why, when });
export const TERMS = [
  T('refactoring', 'Rewriting code to be cleaner without changing what it does.',
    'Your app does the same thing but becomes easier to read, extend, and fix — and cheaper to change later.',
    'When a file is confusing or duplicated and you want to tidy it before adding new features.'),
  T('debugging', 'Finding and fixing why code misbehaves.',
    'Every app has bugs; knowing how to hunt them (logs, errors, breakpoints) is the skill that unblocks you.',
    'When something is broken and the error message isn\'t obvious.'),
  T('rls (row-level security)', 'Database rules that restrict which rows a user can see or change.',
    'If you skip RLS, users can read each other\'s data. It is the safety net for multi-user apps.',
    'Any time your app stores per-user data in a database like Supabase/Postgres.'),
  T('auth', 'Proving who a user is (and what they may do).',
    'Without auth, anyone can act as anyone. It is the front door of your app.',
    'When users log in, or when any endpoint touches private data.'),
  T('environment variable', 'A value stored outside your code, read at runtime (e.g. API keys).',
    'Keeping secrets out of code means they can\'t be committed to git or copied with the repo.',
    'For every API key, URL, or secret your app needs. Stored in .env, never in code.'),
  T('dependency', 'A library your project installs and imports.',
    'Every dependency is code you trust — more deps = more attack surface and more that can break.',
    'When adding a package, ask whether you really need it; keep the list small and updated.'),
  T('deploy', 'Making your app available to real users (putting it on a server/URL).',
    'Nothing matters until users can reach it; deploys are where config breaks usually surface.',
    'After you build something you want others to use.'),
  T('API key', 'A secret token that lets your app call a service (Stripe, OpenAI, maps, …).',
    'A leaked key lets anyone spend your money or read your data. Treat it like a password.',
    'Any time your app talks to a third-party service. Keep it in .env, never commit it.'),
  T('endpoint', 'A specific URL your app exposes that returns data or does something.',
    'Endpoints are the doors into your app — knowing them tells you what the backend actually does.',
    'When tracing how a button on the page reaches your server.'),
  T('route', 'The mapping from a URL to the code that handles it.',
    'Routes are how a web app decides what to show for each address.',
    'When you open a URL and want to find the code behind it.'),
  T('middleware', 'Code that runs between the request arriving and your handler.',
    'Middleware is where auth checks, logging, and error handling usually live — often invisibly.',
    'When a request works but you can\'t see why, or when you want to add a check to every request.'),
  T('migration', 'A script that changes your database structure (add/alter tables).',
    'Migrations are how schema changes travel safely to the live database instead of hand-editing.',
    'Whenever you change what a table stores.'),
  T('schema', 'The structure of your database — tables, columns, types.',
    'The schema is the shape of your data; mismatches between code and schema are a top bug source.',
    'When an error says a column doesn\'t exist or data saves oddly.'),
  T('webhook', 'A URL a service calls to notify your app of an event.',
    'Webhooks are how Stripe tells you "payment succeeded" — they\'re how money moves without polling.',
    'When your app needs to react to an outside event (payments, signups).'),
  T('CI/CD', 'Automatically running tests and shipping on every change.',
    'CI catches breakage before users see it; CD removes the scary manual deploy.',
    'When a project grows past "just me and my local machine".'),
  T('ORM', 'A library that lets you use your database through code objects instead of raw SQL.',
    'ORMs speed you up but hide the query — knowing the query helps when things are slow.',
    'When your app stores data and you use Prisma/Drizzle/TypeORM/SQLAlchemy.'),
  T('package.json', 'The manifest file that lists your Node project\'s name, scripts, and dependencies.',
    'It\'s the first file a Node app is judged by — scripts there define how the app runs and builds.',
    'When a Node project starts with "how do I run this" — read the scripts field.'),
  T('database', 'Where your app stores structured data (users, orders, posts).',
    'The database is the source of truth; losing or corrupting it is the worst failure mode.',
    'When you want to know where user data lives or why a value changed.'),
  T('linter', 'A tool that checks your code for mistakes and style problems automatically.',
    'Linters catch bugs and inconsistencies before they reach users — free code review.',
    'When code style is inconsistent or you want to catch obvious mistakes early.'),
  T('type', 'A label for what kind of data a value is (string, number, object, …).',
    'Type errors are a huge source of crashes; knowing types helps you predict what code can do.',
    'When a value isn\'t what you expected and the error mentions a type.'),
  T('git', 'The version-control system that snapshots your code over time.',
    'Git is your undo button and your safety net — every change is a story you can rewind.',
    'Before changing anything, so you can compare and recover.'),
  T('npm', 'The package manager that installs Node libraries and runs your scripts.',
    'npm is how your project gets its dependencies and how you run dev/build commands.',
    'When you see "npm install", "npm run dev", or a package.json scripts list.'),
  T('server', 'A program that runs continuously and answers requests from users.',
    'Your app\'s server is the "always-on" part; understanding it means knowing where the app lives.',
    'When the app is "down" or a URL returns an error.'),
  T('API', 'A set of defined ways for programs to talk to each other.',
    'Every third-party service and most of your own backend is an API — it\'s how apps exchange data.',
    'When you wonder how two pieces of software pass data to each other.'),
];
export const lookup = (q) => {
  const s = String(q || '').toLowerCase().trim();
  return TERMS.find((t) => t.term.toLowerCase() === s || t.term.split(' (')[0].toLowerCase() === s) || null;
};
export const renderTerm = (e) => e ? `TERM: ${e.term}\n\nWhat it is:\n${e.what}\n\nWhy it matters to you:\n${e.why}\n\nWhen you'd use it:\n${e.when}` : 'not found';
// findMatches: exact substring match, plus stem/word-prefix so prose verbs
// (e.g. "refactor") match their glossary noun forms (e.g. "refactoring").
export const findMatches = (text) => {
  const t = String(text || '').toLowerCase();
  const words = t.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return TERMS.filter((e) => {
    const k = e.term.split(' (')[0].toLowerCase();
    if (t.includes(k)) return true;
    return words.some((w) => w.startsWith(k) || k.startsWith(w));
  }).map((e) => e.term);
};
