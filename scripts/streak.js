// Builds the GitHub streak card from the same contribution data GitHub shows on the profile.
// Run by .github/workflows/streak.yml. Needs GITHUB_TOKEN (and USERNAME) in the environment.
// Local preview without a token: node scripts/streak.js --mock
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'streak', 'streak.svg');
const USER = process.env.USERNAME || 'priyanshupatel288';

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// Every day since the account was created, as [{ date: 'YYYY-MM-DD', count }]
async function fetchDays() {
  const { user } = await gql('query($u:String!){ user(login:$u){ createdAt } }', { u: USER });
  const days = [];
  let total = 0;
  let from = new Date(user.createdAt);
  const now = new Date();
  while (from < now) {
    const to = new Date(Math.min(now, new Date(from.getTime() + 365 * 864e5)));
    const data = await gql(
      `query($u:String!,$f:DateTime!,$t:DateTime!){ user(login:$u){ contributionsCollection(from:$f,to:$t){
        contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } } } } }`,
      { u: USER, f: from.toISOString(), t: to.toISOString() });
    total += data.user.contributionsCollection.contributionCalendar.totalContributions;
    for (const w of data.user.contributionsCollection.contributionCalendar.weeks)
      for (const d of w.contributionDays) days.push({ date: d.date, count: d.contributionCount });
    from = to;
  }
  // de-duplicate overlapping windows, keep order
  const map = new Map(days.map(d => [d.date, d.count]));
  const list = [...map].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
  list.total = total; // GitHub's own total, same number the profile and summary card show
  return list;
}

function mockDays() {
  const days = [];
  const start = new Date('2026-07-15'), end = new Date();
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 864e5)) {
    const i = Math.round((d - start) / 864e5);
    days.push({ date: d.toISOString().slice(0, 10), count: (i % 9 === 4) ? 0 : (i * 7) % 13 + 1 });
  }
  return days;
}

function stats(days) {
  const total = days.total ?? days.reduce((n, d) => n + d.count, 0);
  let longest = { len: 0 }, run = null;
  for (const d of days) {
    if (d.count > 0) {
      run = run ? { ...run, end: d.date, len: run.len + 1 } : { start: d.date, end: d.date, len: 1 };
      if (run.len > longest.len) longest = run;
    } else run = null;
  }
  // current streak: may end today or yesterday (today might not have contributions yet)
  let i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i--;
  let cur = { len: 0 };
  if (i >= 0 && days[i].count > 0) {
    let j = i;
    while (j > 0 && days[j - 1].count > 0) j--;
    cur = { start: days[j].date, end: days[i].date, len: i - j + 1 };
  }
  return { total, first: days[0]?.date, longest, cur };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = s => { const [y, m, d] = s.split('-').map(Number); return `${MON[m - 1]} ${d}`; };
const range = r => (r.len ? `${fmt(r.start)} - ${fmt(r.end)}` : 'No streak yet');

function render({ total, first, longest, cur }) {
  const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif`;
  const P = '#7A18F5', BLUE = '#2f80ed', MUTED = '#8b949e';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195">
  <style>
    text { font-family: ${FONT}; text-anchor: middle; }
    .num { font-size: 28px; font-weight: 700; }
    .lbl { font-size: 14px; }
    .sub { font-size: 12px; fill: ${MUTED}; }
  </style>
  <line x1="165" y1="28" x2="165" y2="170" stroke="${MUTED}" stroke-opacity="0.6"/>
  <line x1="330" y1="28" x2="330" y2="170" stroke="${MUTED}" stroke-opacity="0.6"/>

  <text x="82.5" y="79" class="num" fill="${BLUE}">${total.toLocaleString('en-US')}</text>
  <text x="82.5" y="115" class="lbl" fill="${BLUE}">Total Contributions</text>
  <text x="82.5" y="145" class="sub">${first ? fmt(first) : ''} - Present</text>

  <circle cx="247.5" cy="71" r="40" fill="none" stroke="${P}" stroke-width="5"/>
  <path d="M247.5 19 c4 6 8 9 8 15 a8 8 0 0 1 -16 0 c0 -4 2 -6 4 -9 c0 4 2 6 4 6 c0 -4 -2 -7 0 -12 z" fill="${P}" stroke="#0d1117" stroke-width="3"/>
  <text x="247.5" y="81" class="num" fill="${BLUE}">${cur.len}</text>
  <text x="247.5" y="138" class="lbl" fill="${P}" font-weight="700">Current Streak</text>
  <text x="247.5" y="160" class="sub">${range(cur)}</text>

  <text x="412.5" y="79" class="num" fill="${BLUE}">${longest.len}</text>
  <text x="412.5" y="115" class="lbl" fill="${BLUE}">Longest Streak</text>
  <text x="412.5" y="145" class="sub">${range(longest)}</text>
</svg>
`;
}

(async () => {
  const days = process.argv.includes('--mock') ? mockDays() : await fetchDays();
  const s = stats(days);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, render(s));
  console.log(`total=${s.total} current=${s.cur.len} (${range(s.cur)}) longest=${s.longest.len} (${range(s.longest)})`);
})().catch(e => { console.error(e); process.exit(1); });
