Everything's ready. One command:


cd ~/Developer/job-board-aggregator
./scripts/run_local.sh fast
That's it — no activate, no env vars. It auto-detects .venv.

What it does: scrapes your 6,201 shortlisted companies → merges into data/chunks → prints the new matching jobs to your terminal.

Expect ~2 hours. Six of the seven platforms finish in minutes; Ashby's rate limiting accounts for nearly all of it. Don't kill it partway — the merge only writes at the very end, so an interrupted run throws away everything.

Then to look at the results:


./scripts/run_local.sh serve
and open http://localhost:8000, click New for me.

If you'd rather not tie up your terminal

nohup ./scripts/run_local.sh fast > scrape.log 2>&1 &

tail -f scrape.log          # watch it
grep -c 429 scrape.log      # count Ashby throttles
Other commands

./scripts/run_local.sh new    # re-list the last 24h of matches, no scraping
./scripts/run_local.sh full   # every company, not just your shortlist (many hours)
If two hours is too slow to be useful day to day, say so and I'll make the one-line change to drop Ashby from the fast tier — that gets it under 10 minutes and lets the occasional full run pick Ashby up.



 python -m http.server