export const systemDesignProblems = [
  {
    id: 1,
    slug: 'url-shortener',
    title: 'Design a URL Shortener',
    difficulty: 'Medium',
    category: 'Web Services',
    tags: ['hashing', 'database', 'caching', 'base62'],
    problemStatement: `Design a URL shortening service like bit.ly. The system should accept a long URL and return a short alias. Clicking the short URL redirects to the original. Target: 100M URLs stored, 1B reads/day, low-latency redirects.`,
    requirements: {
      functional: ['Shorten a long URL to a unique short code', 'Redirect short URL to original URL', 'Support optional custom aliases', 'URLs expire after configurable TTL'],
      nonFunctional: ['Read latency < 10ms P99', '99.99% availability', '100M stored URLs', '~11,500 reads/sec'],
    },
    capacityEstimates: `Writes: 100M URLs / (365 * 86400) ≈ 3 writes/sec\nReads: 1B/day ≈ 11,500 rps\nStorage: 100M × 500B = 50 GB\nCache: top 20% of URLs absorbs ~80% of traffic`,
    solutionBreakdown: [
      { section: 'API Design', content: 'Public surface, with idempotency on the write path:\n  POST /shorten { long_url, custom_alias?, ttl_seconds? }  -> 201 { short_code, short_url, expires_at }\n  GET  /{short_code}  -> 302 redirect to long_url (or 301 if analytics not needed)\n  DELETE /{short_code}  (owner-authenticated)\n  GET  /api/stats/{short_code}  -> { clicks, last_click_at, top_referrers }\n\nThe POST takes an optional Idempotency-Key header so retries return the same short_code rather than minting a new one. Custom aliases use the same urls table but are reserved against the same unique index — collision is an integrity error caught by the database.' },
      { section: 'Short Code Generation', content: 'Base62-encode a 64-bit monotonically-increasing ID. 62^7 = 3.5 trillion codes, plenty of headroom for decades. The hard part is the ID source. Three viable choices:\n\n  1. A single Postgres sequence: simplest, but the sequence is a coordination point and caps write throughput to one box.\n  2. Snowflake-style 64-bit IDs (timestamp + machine + sequence): no coordination, time-sortable, but leaves gaps.\n  3. A central allocator that hands batches of 1,000 IDs to each app server: amortises coordination to one round-trip per 1,000 writes.\n\nAt 3 writes/sec average the simple sequence is plenty. Switch to option 3 only if write rate climbs past ~5K/sec.' },
      { section: 'Avoiding Hash Collisions and Guessable Codes', content: 'Why not MD5 the long URL and truncate? Two reasons. First, the same URL submitted by different users collapses to one code — fine for some products, wrong for ones that track ownership or per-user TTLs. Second, truncated hashes collide and force you to re-hash with a suffix, which is exactly the coordination you were trying to avoid.\n\nIf you need non-enumerable codes (so people cannot scan competitors\' URLs), XOR the auto-increment ID with a secret 64-bit constant before Base62-encoding, or use a small Feistel network as format-preserving encryption on the ID. Codes stay unique and reversible internally but look random externally.' },
      { section: 'Data Model', content: 'Two tables to keep the hot path narrow:\n  urls(short_code VARCHAR(10) PK, long_url TEXT NOT NULL, user_id BIGINT, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NULL, is_custom BOOL)\n  click_counts(short_code, day, count, last_click_at)  -- separated so click writes never block the lookup\n\nIndexes: PK on short_code (lookup path), partial index on expires_at WHERE expires_at IS NOT NULL (TTL sweeper), index on user_id (owner dashboards). long_url is stored verbatim — no canonicalisation, since two different long URLs that happen to resolve to the same destination remain semantically two different links.' },
      { section: 'Storage Choice', content: 'Postgres for the urls table. The workload is dominated by single-row PK lookups with a moderate write rate. ACID matters for custom-alias collision checks — the unique constraint blocks duplicates atomically. A NoSQL KV store would be faster for raw reads but you lose the unique-alias guarantee and end up enforcing it in app code, which races under concurrent custom-alias creation.\n\nFor 100M rows × ~500 bytes = ~50GB, a single Postgres instance with a read replica is enough. Past ~1B rows, range-shard by short_code prefix or move to a horizontally-scalable store (CockroachDB, Spanner) — both keep the unique constraint across shards.' },
      { section: 'Caching for Read-Heavy Workload', content: 'Reads outnumber writes ~4000:1 (11.5K rps vs 3 wps). URL access follows a Zipf distribution — a small fraction of links absorb most clicks. Redis cache in front of Postgres with LRU eviction:\n\n  cache.get(short_code) -> long_url, or null on miss\n  on miss: SELECT long_url FROM urls WHERE short_code = $1; cache.set(short_code, long_url, ttl=24h)\n  on delete: cache.delete(short_code) and invalidate at the CDN\n\nExpected hit ratio: 85-95% with a few GB of Redis. The cache also blunts pathological scanners — a bot probing random codes hits a short-lived negative entry (60s TTL) for not-found codes instead of hammering the DB.' },
      { section: 'Redirect Semantics: 301 vs 302', content: '301 Permanent Redirect: browsers and CDNs aggressively cache the mapping. The first click hits your server; subsequent clicks from the same browser go straight to the long URL without touching you. Lowest latency, lowest server cost, but you lose every click event after the first per browser.\n\n302 Found: browser revalidates every time. You see every click — needed for analytics, A/B routing, geo-targeting, or TTLs that revoke active links.\n\nThe right answer depends on the product. For analytics-driven products (bit.ly, Linktree) 302 is mandatory. For pure-performance shortening (CDN purpose codes) 301 with a long Cache-Control max-age is the cheaper choice.' },
      { section: 'Click Analytics Pipeline', content: 'Synchronous counting on the redirect path either contends on a single row or requires a write-amplified counter table. Instead the redirect service emits a click event to Kafka (user_agent, referrer, ip-hash, timestamp, short_code) and returns the redirect immediately. A consumer rolls up per-day counters in Redis HINCRBY, with a periodic flush (every 60s) to click_counts.\n\nThis keeps the hot redirect path at a single Redis GET plus a fire-and-forget Kafka produce — well under 10ms P99. The pipeline is lossy in extreme failure cases (Kafka outage drops events), which is acceptable for analytics; never acceptable for billing or auth.' },
      { section: 'TTL and Expiry', content: 'A janitor job runs hourly: DELETE FROM urls WHERE expires_at < NOW() LIMIT 10000 in batches, with a small pause between batches to avoid replication lag. Deleted codes are also explicitly purged from Redis and a tombstone is left in a Bloom filter for 24h so an expired code does not get a stale cache hit if Redis briefly forgot the negative entry.\n\nDeleted codes are NOT reused. Reusing a code that previously pointed to a different link is a security hazard — old QR codes, printed materials, and emails would suddenly resolve to attacker-controlled URLs.' },
      { section: 'Custom Aliases and Reservation', content: 'POST /shorten { custom_alias: "summer-sale" } inserts with the supplied alias as short_code. The unique constraint catches collisions atomically — handle the integrity error and return 409 Conflict. A small denylist (profanity, reserved words like "admin", "api", "static") is checked before the insert. Custom aliases share the same code space as generated ones; the is_custom flag is metadata for the dashboard, not used in routing.' },
      { section: 'Abuse, Phishing, and Safe Browsing', content: 'Short URLs are catnip for phishing — they hide the destination. Three defences:\n\n  1. On submit, check the long_url against Google Safe Browsing or PhishTank. Reject known-malicious domains synchronously.\n  2. Asynchronous re-check: a worker periodically re-evaluates all live URLs and disables any that newly appear on threat lists. Disabled codes redirect to an interstitial warning page instead of the destination.\n  3. Rate-limit writes per IP and per user. A free tier should not be able to generate 10K codes in a minute.\n\nThe redirect service also sets Referrer-Policy: no-referrer-when-downgrade so the long URL is not leaked to third parties.' },
      { section: 'Failure Modes and Recovery', content: 'Redis down: redirect service falls through to Postgres. Latency rises from ~5ms to ~20ms but the service stays up. A circuit breaker on the Redis client caps the damage.\n\nPostgres primary fails over: reads keep working from the read replica (used as the fallback for redirect); writes briefly fail with 503 until the new primary is promoted. Idempotency keys ensure retried POST /shorten does not double-create.\n\nKafka outage: redirects continue; click events buffer to a local on-disk queue with a bounded size and replay when Kafka returns. If the local queue fills, events are dropped and a metric is emitted so the analytics team can scale Kafka or accept the loss.\n\nDeleted code accidentally re-requested: returns 410 Gone, never 404 — caches must not assume the URL might come back.' },
      { section: 'Observability', content: 'Per-second metrics scraped to Prometheus:\n  redirect_latency P50/P99 (alert on P99 > 50ms)\n  cache_hit_ratio (alert if < 70%)\n  shorten_error_rate (alert > 1%)\n  custom_alias_collision_rate (signals namespace squatting)\n  click_event_kafka_lag (alert > 60s)\n\nEvery redirect emits a structured log line with short_code, hashed-IP, user_agent, status, and latency. Logs ship to a centralised store for the analytics dashboard and for abuse investigations. A daily reconciliation compares total click events shipped to Kafka against rollups in click_counts; drift > 0.1% triggers an investigation.' },
      { section: 'Scaling Levers', content: 'Writes are tiny (3/sec) — scaling is purely about reads. Levers in order of cost-effectiveness:\n\n  1. CDN in front of the redirect endpoint. Set Cache-Control: public, max-age=300 on 301 responses and the CDN serves them with zero server cost.\n  2. Redis size — push hit ratio from 85% to 95% by doubling cache memory. Cheaper than adding app servers.\n  3. App-server horizontal scaling, fronted by an L4 load balancer. Services are stateless.\n  4. Read replicas on Postgres for fallback when Redis misses.\n  5. Geo-distributed Redis (or a read-only edge KV like Cloudflare Workers KV) once cross-region latency matters.\n\nShard the urls table only after a single Postgres can no longer hold the dataset (~1B rows). Shard by short_code prefix so any code routes to one shard with no fan-out.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Web[Web App]
        Mobile[Mobile App]
        Bot[Bot or API Caller]
    end
    subgraph Edge
        CDN[CDN Edge Cache]
        LB[Load Balancer]
    end
    subgraph Gateway
        APIGW[API Gateway]
        Auth[Auth Service]
        RL[Rate Limiter]
    end
    subgraph Services
        Shorten[Shorten Service]
        Redirect[Redirect Service]
        Custom[Custom Alias Service]
        Analytics[Click Analytics Svc]
        Expire[Expiry Service]
        UserSvc[User Account Svc]
    end
    subgraph Async
        ClickQ[Click Event Queue]
        ClickW[Click Aggregator]
        ExpireJob[TTL Sweeper Job]
    end
    subgraph Storage
        IDGen[(ID Generator Base62)]
        URLDB[(URL Store PostgreSQL)]
        Cache[(Redis Hot URLs)]
        UserDB[(User DB)]
        ClickDB[(Click Counts DB)]
    end
    subgraph Analytics2 [Analytics]
        EventBus[Kafka Events]
        Lake[(Data Lake)]
    end

    Web -->|POST shorten| APIGW
    Mobile -->|POST shorten| APIGW
    APIGW --> Auth
    APIGW --> RL
    APIGW --> Shorten
    Shorten --> IDGen
    Shorten --> URLDB
    Shorten -->|custom alias| Custom --> URLDB

    Bot -->|GET shortcode| CDN
    CDN -->|cache miss| LB --> APIGW
    APIGW --> Redirect
    Redirect --> Cache
    Cache -->|miss| URLDB
    Redirect -->|click event| ClickQ --> ClickW --> ClickDB
    Redirect --> EventBus

    Web -->|view stats| APIGW --> Analytics --> ClickDB
    Web -->|delete URL| APIGW --> Shorten
    APIGW --> UserSvc --> UserDB

    ExpireJob --> URLDB
    ExpireJob --> Cache
    EventBus --> Lake

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class IDGen,URLDB,Cache,UserDB,ClickDB storage
    class ClickQ,ClickW,ExpireJob async
    class CDN,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: '301 vs 302 redirect', rationale: '301 lets browsers and CDNs cache the redirect indefinitely, cutting server cost to near zero but blinding you to all but the first click per browser. 302 keeps every request reaching your server, which you need for click analytics, A/B routing, and revocable TTLs. Pick 302 if click data has any product value; 301 only for pure-performance use cases.' },
      { decision: 'Base62-encoded auto-increment ID vs hash of long URL', rationale: 'Auto-increment + Base62 is collision-free without a check, produces short codes (7 chars for 3.5T URLs), and is cheap. Hash-of-URL makes codes deterministic and stateless but forces collision detection and prevents two different users owning the same URL with different TTLs. Use auto-increment unless you have a strong reason for determinism.' },
      { decision: 'Postgres with Redis cache vs Cassandra/DynamoDB', rationale: 'Postgres gives you the unique constraint for custom aliases atomically — invaluable when multiple users race for the same alias. Cassandra-style stores scale writes higher but force application-level alias arbitration, which races. Use Postgres until you exceed a billion rows; switch to a horizontally-scalable SQL store (CockroachDB, Spanner) before NoSQL.' },
      { decision: 'CDN-cacheable redirects vs always-origin', rationale: 'Serving 301s through a CDN with a 5-minute Cache-Control collapses thousands of requests for hot links into one origin hit, which is the cheapest scaling lever you have. The trade-off is that revocation now has CDN purge latency (~30s) and analytics misses the cached hits. Wire CDN purges into the delete path and accept the analytics gap, or skip CDN and pay for app servers.' },
      { decision: 'Synchronous click counter vs async event stream', rationale: 'Sync INCR on a counter row is simple but turns the row into a hot spot and adds 1-2ms to the redirect. Async Kafka + rollup worker keeps the redirect path single-digit-ms and absorbs spikes, at the cost of small bounded loss in extreme outages. Use async for analytics; never use it for anything billable.' },
    ],
    keyTakeaways: [
      'Base62 encoding of monotonically-increasing IDs gives collision-free, compact codes without any coordination beyond a single sequence',
      'Redis caching plus a CDN absorbs the heavy read:write ratio cheaply — most clicks should never touch your database',
      'Custom aliases need a real unique constraint in a transactional store, not application-level arbitration, or you will race under concurrent submissions',
      'Click analytics belong on an async pipeline (Kafka + rollup worker), not inline on the redirect path — anything else either adds latency or creates a hot row',
      'Deleted short codes must never be reissued; reuse turns old QR codes and emails into a phishing distribution channel',
    ],
    faqs: [
      { question: 'Why Base62 specifically — not Base64 or hex?', answer: 'Base62 uses [0-9A-Za-z], which is URL-safe without any percent-encoding. Base64 uses + and / which both need encoding in URLs, defeating the point of a short code. Hex is URL-safe but wastes characters: hex encodes 4 bits per character, Base62 encodes ~5.95 bits per character, so a 64-bit ID is 11 hex characters vs 7 Base62 characters. Base58 (Bitcoin) drops the visually-confusable characters (0/O, I/l) and is a fine alternative if codes will be hand-typed.' },
      { question: 'How do you stop someone scanning all codes to enumerate URLs?', answer: 'If you just Base62-encode the auto-increment ID, code 0000001 is followed by 0000002 — easy to enumerate. Two common defences. First, XOR the ID with a secret 64-bit constant before encoding so codes look random while staying unique. Second, treat the ID as a small Feistel cipher input — format-preserving encryption keeps the ID space bijective but makes the mapping unpredictable. Both are stateless and reversible internally, so you still resolve codes with a single DB lookup. Layer on per-IP write rate limits to stop scrapers from creating-and-checking codes themselves.' },
      { question: 'What happens when two users submit the same custom alias at the same time?', answer: 'Both requests INSERT into urls with the same short_code as PK. Postgres enforces the unique constraint — exactly one INSERT succeeds, the other raises a unique-violation error which the API translates to 409 Conflict. The losing user retries with a different alias. The whole arbitration is atomic and lives in the database; application-level "is this alias taken?" checks race because two clients can both see "available" before either commits. Never enforce uniqueness in application code unless your store has no unique index.' },
      { question: 'Should the redirect be 301 or 302 — be specific.', answer: 'Use 302 by default. The cost of a 301 mistake is that you can never reliably retract a URL: browsers cache the 301 for the lifetime of the entry (often days, sometimes weeks), and any future change is invisible to that user. 302 keeps you in control: every click hits your edge so you can track, A/B test, geo-route, or revoke. The only case for 301 is when the link is truly immutable and you want the CDN-friendly caching headers — for example, links pointing to canonical asset URLs. For consumer link-shortening products, 302 is the right answer almost every time.' },
      { question: 'How do you handle a malicious URL that becomes malicious after creation?', answer: 'Two layers. At create time, hit Safe Browsing / PhishTank synchronously and reject known-bad. After creation, a background worker re-evaluates every live URL on a rolling schedule (e.g., every 24h for low-traffic, every hour for high-click links). If a URL turns bad, flip a column on the urls row to disabled and the redirect service serves an interstitial warning page instead of the long URL. Disabled is preferable to delete because the interstitial preserves your reputation — users see "this link was flagged" rather than 404, which looks like your service is broken.' },
      { question: 'Why a separate click_counts table instead of a counter column on urls?', answer: 'A counter on urls would be the hottest column in the database — every redirect issues an UPDATE, those updates serialise on the row, and the index is constantly being rewritten. Splitting click counts into a separate table (or out of the database entirely into Redis) keeps redirect reads on the lookup path off the contended writes. You also typically want time-bucketed counts (clicks per day, per referrer) for analytics, which a single counter column cannot express. The trade-off is dual writes; recover by reconciling Redis rollups against the Kafka event log nightly.' },
      { question: 'Do you need a separate read replica if Redis is in front of Postgres?', answer: 'Yes, for two reasons. First, Redis is a cache, not a replica — if Redis goes down or evicts cold entries, all reads fall back to Postgres at once, and the primary cannot absorb that surge without a replica to shed load to. Second, the analytics dashboard does range scans (clicks for my links last week) that should never run against the write primary. A read replica is cheap insurance for both. Configure the application to read-after-write from the primary for owner dashboards to avoid replica-lag confusion.' },
      { question: 'How much Redis memory do you actually need?', answer: 'At 100M URLs × ~100 bytes per cached entry, you would need ~10GB to cache everything. But you do not need to — Zipfian access means 5-10% of URLs absorb most traffic. ~500MB-1GB of Redis comfortably hits 90% cache hit rate. Monitor evictions: a healthy cache evicts a steady trickle of cold keys. If eviction rate spikes, either the working set grew (need more memory) or someone is scanning random codes (need rate limiting). Plan for a 2x cushion to absorb hot-link events like a viral tweet.' },
      { question: 'What is the right TTL for custom-TTL URLs versus default URLs?', answer: 'Default URLs can be effectively immortal — set expires_at NULL and never sweep them. They are cheap and removing them retroactively breaks the internet. Custom-TTL URLs (set by API consumers for marketing campaigns or one-time tokens) should honor the user-supplied TTL exactly. The janitor sweeps expired rows in batches with a partial index on expires_at WHERE NOT NULL so the sweep does not scan the immortal majority. After sweep, purge the code from Redis and leave a 24h Bloom-filter tombstone to prevent stale negative-cache hits.' },
      { question: 'Could you skip Postgres entirely and run on DynamoDB or Cloudflare KV?', answer: 'Yes for a simple short-only product. DynamoDB gives you single-digit-ms lookups, global tables for multi-region, and on-demand pricing. Cloudflare Workers KV puts the data at the edge so the redirect runs with zero round-trips to a central region. What you lose: the unique constraint for custom aliases must move into your application (conditional PUT with attribute_not_exists), and atomic increments for click counts get harder. For a no-custom-alias, no-billing service, edge KV plus a Workers script is the simplest architecture today. For a product with custom aliases or billing, the unique constraints and ACID transactions on Postgres are still worth the hop.' },
    ],
  },
  {
    id: 2,
    slug: 'design-twitter-feed',
    title: 'Design Twitter / Social Feed',
    difficulty: 'Hard',
    category: 'Web Services',
    tags: ['feed', 'fanout', 'caching', 'pub-sub'],
    problemStatement: `Design a Twitter-like system where users can post tweets, follow other users, and see a personalized feed of recent tweets from people they follow. Target: 300M daily active users, 600M tweets/day, timeline reads 10× more than writes.`,
    requirements: {
      functional: ['Post a tweet (text, images)', 'Follow/unfollow users', 'View a home timeline of tweets from followed users', 'View a user profile timeline'],
      nonFunctional: ['Timeline load < 200ms', '99.9% availability', '300M DAU', 'Handle celebrity accounts with millions of followers'],
    },
    capacityEstimates: `Tweets: 600M/day ≈ 7,000 writes/sec\nTimeline reads: 70,000 reads/sec\nStorage: 600M tweets × 280B text ≈ 170 GB/day\nMedia: separate blob storage, linked by URL`,
    solutionBreakdown: [
      { section: 'API Design', content: 'Core endpoints on the write and read paths:\n  POST /tweets { text, media_ids? }  -> 201 { tweet_id, created_at }\n  GET  /timelines/home?cursor=&limit=20  -> { tweets[], next_cursor }\n  GET  /users/{handle}/tweets?cursor=&limit=20  -> profile timeline\n  POST /follow { target_user_id }\n  DELETE /follow/{target_user_id}\n  POST /tweets/{id}/like, /tweets/{id}/retweet\n\nPagination uses opaque cursors (a Snowflake tweet_id) so the client never sees offsets. Cursor-based paging is stable under concurrent inserts; offset paging skips tweets when new ones land.' },
      { section: 'Tweet Storage', content: 'Store tweets in Cassandra partitioned by user_id, clustered by tweet_id descending. Each row: tweet_id (Snowflake), user_id, text, media_refs (list of S3 keys), in_reply_to, created_at. Snowflake IDs are 64-bit integers composed of a 41-bit millisecond timestamp, 10-bit machine ID, and 12-bit sequence number — globally unique without coordination, and time-sortable so the clustering order is the chronological order.\n\nWhy Cassandra: write-heavy (7K wps sustained, 10x peak), partition-friendly, and the read pattern for the profile timeline is a single contiguous slice from one partition.' },
      { section: 'Snowflake IDs', content: 'Why not auto-increment? At 7K writes/sec a single sequence is feasible but couples writes to one box. Why not UUIDv4? Random IDs destroy cache locality and explode index size. Snowflake hits the sweet spot: monotonically time-ordered, no coordination, fits in a 64-bit int.\n\nClock skew is the catch — if a node clock drifts backwards, sequence numbers can collide. NTP-sync every node, refuse to issue IDs if the clock jumps backwards more than a few milliseconds, and use a per-machine epoch offset so two nodes never share the timestamp+machine bits.' },
      { section: 'Fan-out on Write (Push Model)', content: 'When a regular user tweets, a worker pushes the tweet_id into each follower\'s home_timeline sorted set in Redis. The set is keyed by user_id with score=timestamp, capped at ~800 entries (more than the deepest scroll any user will reach).\n\nReads become a single Redis ZREVRANGE — sub-millisecond. Writes are amplified by the follower count: a user with 1,000 followers triggers 1,000 Redis writes per tweet. For median users (median follower count is small, often double digits) this is cheap. The model breaks for celebrities.' },
      { section: 'Celebrity Problem — Fan-out on Read', content: 'A user with 50M followers cannot afford fan-out on write: one tweet = 50M Redis writes, with massive write amplification spikes during big events.\n\nSwitch model for any user with >100K followers: do not fan out at all. At read time, the timeline service:\n  1. Fetches the precomputed home_timeline from Redis (regular-user tweets).\n  2. Fetches the recent tweets from every celebrity the reader follows directly from celebrity-tweet caches (pre-populated, one cache per celebrity).\n  3. Merges by timestamp and trims to the page size.\n\nA reader following 1,000 accounts of which 5 are celebrities pays 1 Redis read + 5 small cache reads + a 6-way merge. Latency stays under 100ms.' },
      { section: 'Hybrid Read Path', content: 'Concrete merge:\n  precomputed = ZREVRANGEBYSCORE home:{user_id} +inf -inf LIMIT 0 200\n  celebrities = follow_graph.celebrities_followed_by(user_id)  // cached per user\n  celeb_tweets = parallel cache.mget(["celeb_recent:{cid}" for cid in celebrities])\n  merged = heap_merge(precomputed, *celeb_tweets, key=timestamp_desc)[:20]\n  hydrated = tweet_service.batch_get(tweet_ids in merged)\n\nHydration is a fan-out batch read against Cassandra keyed by tweet_id, parallelised across partitions. Cache hot tweets (any tweet from the last hour) in Redis to skip Cassandra entirely for the head of the timeline.' },
      { section: 'Follow Graph', content: 'Edges are followers(follower_id, followee_id, created_at) in a horizontally-sharded relational store, with both columns indexed. The hot queries are "who do I follow?" (for timeline read) and "who follows me?" (for fan-out write).\n\nFor a celebrity with 50M followers the follower list is paginated and processed in chunks of 10K — fan-out is parallelised across many workers. The followee list per user is typically small (<10K) and fits in memory; cache it in Redis with a 30s TTL so home-timeline reads do not re-query the graph every time.' },
      { section: 'Media Handling', content: 'Two-step upload. Client requests a presigned S3 URL (POST /media/upload-url), uploads bytes directly to S3, and gets back a media_id. Posting the tweet attaches the media_id.\n\nS3 object-created events trigger async workers: thumbnail generation (3 sizes), perceptual-hash NSFW detection, virus scan. Media URLs are signed at read time so we can revoke access for deleted tweets or banned users. CDN sits in front of S3 for delivery — most reads never touch the origin.' },
      { section: 'Cassandra Schema and Partitioning', content: 'Tweets table:\n  PARTITION KEY user_id, CLUSTERING KEY tweet_id DESC\n  (text, media_refs, reply_to, like_count_cached, created_at)\n\nProfile timeline is a single-partition slice: SELECT * FROM tweets WHERE user_id = ? AND tweet_id < cursor LIMIT 20. No secondary index, no fan-out — this is why Cassandra is fast for this workload.\n\nReverse-lookup tables (because Cassandra denormalises): tweets_by_id (PK tweet_id) for hydration, retweets (PK tweet_id, CK retweeter_id) for retweet lists. Maintain via async updates from the same event stream so the source tweet table stays the system of record.' },
      { section: 'Like and Retweet Counters', content: 'Synchronous UPDATE on a per-tweet counter would contend on a single row for viral tweets — a tweet seeing 100K likes/sec would lock the row.\n\nInstead, likes/retweets emit events to Kafka. A counter service (Redis HINCRBY by tweet_id, flushed to Cassandra every 30s) absorbs the writes. The like button shows an optimistic count from the client side, then the server\'s eventually-consistent number replaces it. For the very hottest tweets, counts batch up in-process at the API layer for 100ms before flushing — typical hot-row optimisation.' },
      { section: 'Search and Indexing', content: 'Tweets are indexed into Elasticsearch via CDC (Debezium tailing Cassandra commit log, or Kafka events emitted by the tweet service). The search index is rebuilt nightly to catch drift.\n\nThe index supports keyword search, hashtag search, and user mention search. Trending topics are a separate per-minute aggregation: count hashtag occurrences in a sliding 60-minute window in Kafka Streams, surface the top-K by region.' },
      { section: 'Failure Modes and Recovery', content: 'Redis timeline cache lost: the timeline service falls back to "pull on demand" — fetch each followee\'s recent tweets, merge, and rebuild the home cache asynchronously. Reads are slow (seconds) but available. Backfill in the background from Cassandra.\n\nFan-out worker backlog: the fan-out queue is a Kafka topic partitioned by user_id. If workers fall behind, lag is visible in the consumer group; auto-scale workers based on lag. Tweets are eventually fanned out, so a backlog manifests as delayed timeline visibility, not lost tweets.\n\nCassandra node down: replication factor 3 across availability zones; reads with consistency LOCAL_QUORUM tolerate a single node loss without hiccup. The tombstone risk (deleted tweets accumulating tombstones) is mitigated by per-day compaction tuning.\n\nCelebrity tweet not yet in cache: the read path returns whatever is in cache and triggers a background warm. UX shows a brief gap (worse than ideal) instead of failing the request.' },
      { section: 'Observability', content: 'Hot metrics on the wall:\n  tweet_post_latency_p99 (alert > 200ms)\n  timeline_read_latency_p99 (alert > 200ms)\n  fanout_queue_lag_seconds (alert > 60s)\n  timeline_cache_hit_ratio (alert < 90%)\n  celebrity_cache_miss_rate (alert > 5%)\n  cassandra_pending_tombstones per partition (alert if a single user is approaching the threshold)\n\nDistributed tracing (Jaeger) on read and write paths to attribute latency to fan-out vs hydration vs media-CDN. Every tweet carries a correlation_id propagated through Kafka so a slow event surface anywhere in the pipeline is debuggable end-to-end.' },
      { section: 'Scaling Levers', content: 'Per axis:\n  Writes: shard tweet storage by user_id, fan-out workers scale on Kafka lag.\n  Reads: Redis timeline cache is the primary lever; add memory before adding nodes. The CDN absorbs media.\n  Hot tweets: in-process micro-batching at the API layer for like counters, plus per-tweet read caches keyed by tweet_id with seconds-scale TTLs.\n  Geo: regional Cassandra clusters with eventual consistency on the global graph; reads stay local, follow changes replicate asynchronously.\n\nThe single biggest cost line at scale is the fan-out write amplification. Tightening the celebrity threshold (currently 100K) lowers cost but pushes more merge work into the read path.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Web[Web App]
        Mobile[Mobile App]
    end
    subgraph Gateway
        APIGW[API Gateway]
        Auth[Auth Service]
        RL[Rate Limiter]
    end
    subgraph Services
        Tweet[Tweet Service]
        Timeline[Timeline Service]
        UserSvc[User Profile Svc]
        FollowSvc[Follow Graph Svc]
        SearchSvc[Search Service]
        Trends[Trends Service]
        DM[Direct Message Svc]
        NotifSvc[Notification Service]
        MediaSvc[Media Service]
    end
    subgraph Async
        FanoutQ[Fan-out Queue]
        FanoutW[Fan-out Workers]
        MediaProc[Media Processor]
        Indexer[Search Indexer]
        TrendsJob[Trends Aggregator]
    end
    subgraph Storage
        TweetDB[(Tweets Cassandra)]
        TLCache[(Timeline Cache Redis)]
        GraphDB[(Follow Graph DB)]
        UserDB[(User DB)]
        ES[(Elasticsearch)]
        DMDB[(DM Cassandra)]
        MediaS3[(Media S3 and CDN)]
    end
    subgraph Analytics
        EventBus[Kafka Events]
        Lake[(Data Lake)]
    end

    Web -->|POST tweet| APIGW
    Mobile -->|POST tweet| APIGW
    APIGW --> Auth
    APIGW --> RL
    APIGW --> Tweet
    Tweet --> TweetDB
    Tweet -->|media refs| MediaS3
    Tweet -->|fan-out msg| FanoutQ --> FanoutW
    FanoutW -->|push tweet_id| TLCache
    FanoutW -->|celebrity skip| TweetDB
    Tweet --> EventBus
    EventBus --> Indexer --> ES
    EventBus --> Lake
    EventBus --> TrendsJob --> Trends

    Web -->|media upload| MediaSvc --> MediaS3
    MediaS3 -->|event| MediaProc --> MediaS3

    Mobile -->|GET timeline| APIGW --> Timeline
    Timeline --> TLCache
    Timeline -->|celebrity merge| TweetDB
    Timeline -->|hydrate| Tweet

    Web -->|search query| APIGW --> SearchSvc --> ES
    Web -->|trends| APIGW --> Trends

    Web -->|follow| APIGW --> FollowSvc --> GraphDB
    FollowSvc --> NotifSvc --> Mobile

    Mobile -->|send DM| APIGW --> DM --> DMDB
    DM --> NotifSvc

    APIGW --> UserSvc --> UserDB

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class TweetDB,TLCache,GraphDB,UserDB,ES,DMDB,MediaS3 storage
    class FanoutQ,FanoutW,MediaProc,Indexer,TrendsJob async
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Fan-out on write vs fan-out on read', rationale: 'Fan-out on write makes timeline reads trivial (one Redis call) but blows up for celebrities — a 50M-follower account would trigger 50M writes per tweet. Fan-out on read makes every read fan out across all followees and is wasteful for the typical low-follower user. Hybrid (write for normal users, read for celebrities, threshold around 100K followers) is the industry-standard answer.' },
      { decision: 'Snowflake IDs vs UUIDv4 vs auto-increment', rationale: 'Snowflake gives you global uniqueness with no coordination and time-sortable IDs that make clustering and pagination efficient. UUIDv4 is uncoordinated but random ordering kills cache locality and bloats indexes. Auto-increment is the simplest but caps your write throughput at the single sequence box. Use Snowflake the moment you need more than one write node.' },
      { decision: 'Cassandra vs PostgreSQL for tweet storage', rationale: 'Cassandra scales linear writes across nodes and absorbs the 7K wps peak without sharding gymnastics. The profile timeline maps cleanly to a single partition read. Postgres would handle the read patterns better with secondary indexes but needs explicit sharding and re-sharding as you grow. Pick Cassandra when you know writes will outpace what one Postgres can sustain.' },
      { decision: 'Optimistic likes vs strongly-consistent counters', rationale: 'Optimistic UI updates with eventually-consistent server counts feel instant to users and let the backend batch hot-row writes off the critical path. Strong consistency on like counts would serialise writes on the row and choke during viral events. The product is happy with eventual counts; the only place strong consistency matters is anti-fraud (preventing rapid like-spam).' },
      { decision: 'Push notifications via fan-out queue vs separate channel', rationale: 'Reusing the fan-out queue is simpler — one worker handles both timeline insertion and notification. But notification volume is different (only triggers on mentions, replies, DMs, not every fan-out), and routing latency expectations differ. Splitting into a dedicated notification service is worth it past ~1K notifications/sec so you can scale and rate-limit independently.' },
    ],
    keyTakeaways: [
      'A hybrid fan-out strategy (write for normal users, read for celebrities) handles the follower-count skew that breaks pure push or pull models',
      'Snowflake IDs give you globally-unique, time-sortable tweet IDs without a coordination point — essential beyond ~1K writes/sec',
      'The Redis home-timeline sorted set is the single biggest reason home timelines load in <100ms; protect cache hit ratio above all else',
      'Counter writes for likes/retweets must batch through Kafka or Redis; synchronous UPDATEs on the tweet row collapse during viral events',
      'CDN-fronted S3 with presigned uploads keeps media bytes off your API servers entirely — the write path stays small and fast',
      'Profile timelines and home timelines are read against completely different stores (Cassandra partition vs Redis sorted set) for completely different reasons',
    ],
    faqs: [
      { question: 'Why use both fan-out on write and fan-out on read instead of just one?', answer: 'The follower count distribution is heavy-tailed. The median user has fewer than 100 followers — fan-out on write writes 100 cheap Redis entries per tweet. A celebrity with 50M followers tweeting under the same model would emit 50M Redis writes synchronously, which is impossible to keep up with during high tweet rate. So you write-fan-out the cheap cases and read-fan-out the expensive ones, paying small extra latency at read time only for users who follow celebrities. The threshold (often 100K followers) is tunable based on the cost of writes vs reads and the redis cluster size.' },
      { question: 'What goes wrong if you use UUIDv4 for tweet IDs?', answer: 'Two things. First, Cassandra clustering by tweet_id assumes the IDs are time-ordered so the clustering order matches the chronological order — UUIDv4 is random, so adjacent tweets in time end up scattered across the partition. Profile timeline reads become random I/O instead of a sequential slice. Second, B-tree indexes on the IDs (in secondary services like search or analytics) become hot in the middle pages instead of at the tail, balloon in size, and lose locality. Snowflake or any time-sortable scheme avoids both problems at the cost of leaking the creation time of the tweet in the ID, which is usually fine.' },
      { question: 'How do you handle a viral tweet getting 100K likes per second?', answer: 'Synchronous UPDATE on a counter column would serialise on the row — Cassandra and SQL stores both fall over. The fix is multi-layer batching. Each like emits a Kafka event with tweet_id. A consumer aggregates increments in Redis HINCRBY counters keyed by tweet_id. Every 30 seconds the consumer flushes the rollup to Cassandra (UPDATE like_count = like_count + delta). For the very hottest tweets, the API layer micro-batches in-process for 100ms before producing to Kafka — collapses 10K events into one. The client UI shows an optimistic count immediately; the server number eventually catches up. Users do not care about exact precision; they care that the number goes up.' },
      { question: 'What does the celebrity read path actually look like?', answer: 'Given a reader with 1,000 follows, of which 5 are flagged celebrities:\n  1. Fetch home_timeline:{reader_id} from Redis — that gets you tweets from the 995 non-celebrity follows.\n  2. Look up the celebrities_followed cache for the reader (computed lazily, cached 60s).\n  3. For each celebrity, fetch celeb_recent:{celebrity_id} from Redis (a per-celebrity precomputed list of their last ~200 tweets).\n  4. Heap-merge by timestamp, take the top 20 for the page.\n  5. Hydrate the 20 tweet IDs from a Redis hot-tweet cache, falling back to Cassandra for any cold ones.\n\nFour to six Redis calls in parallel, plus one batch hydration. Tens of milliseconds end to end.' },
      { question: 'How is the home timeline cache populated when a new user signs up?', answer: 'The cache key home:{user_id} is empty for a new user. When they make their first home timeline request, the timeline service backfills synchronously: fetch the last 200 tweets per followee in parallel, merge, write into the sorted set, then return the page. For a user following 100 accounts, that is ~100 parallel calls to Cassandra hot-tweet caches — finishes in 50-100ms. Subsequent reads use the cached set. New follows trigger a lightweight cache-update: insert the followee\'s recent tweets into the existing set.' },
      { question: 'What happens to the timeline cache when a user unfollows someone?', answer: 'You have two choices. Lazy: do nothing — the existing tweets stay in the home_timeline sorted set, but no new tweets from the unfollowed user are added. The unfollowed tweets age out as the set is trimmed to its 800-entry cap. This is the cheap, eventually-correct option most platforms pick. Eager: scan the sorted set for tweets from the unfollowed user and ZREM them — costs O(N) on the cache, gives an immediate clean timeline. Eager is what you do for blocks/mutes (where you cannot afford to show the offending tweets); lazy is fine for unfollows.' },
      { question: 'Does the fan-out queue guarantee every follower sees the tweet?', answer: 'Effectively yes, with at-least-once semantics. The fan-out worker reads from a Kafka topic partitioned by author user_id, processes follower batches of 10K, and writes ZADDs to Redis. If a worker crashes mid-batch, Kafka redelivers; the ZADD is idempotent (same tweet_id, same score), so duplicate processing is harmless. The only way a follower fails to see the tweet is if their home_timeline sorted set itself is evicted from Redis between fan-out and read, in which case the fallback path re-fetches from the source on the next read. The system is "at least once into the cache, with self-healing fallback."' },
      { question: 'Why split media to S3 and not store it inline with the tweet row?', answer: 'A tweet row is dozens of bytes; a video is megabytes. Storing media inline blows up partition size, kills compaction, and makes every read drag the binary across the network even if the client only wanted text. S3 is built for blob storage, integrates with the CDN, and supports presigned uploads so bytes never touch your API servers. The tweet row stores S3 keys; the read path returns signed URLs the client fetches directly from the CDN. This separation also lets you replace the media subsystem (e.g., switch CDNs) without touching the tweet store.' },
      { question: 'How do hashtag search and trending topics work?', answer: 'Hashtags are extracted at tweet-write time (regex on the text) and indexed into Elasticsearch alongside the tweet content. Search hits ES, which returns tweet_ids, then the timeline service hydrates them — same hydration path as the home timeline. Trending topics are a separate Kafka Streams job: window-count hashtag occurrences in a sliding 60-minute window, partitioned by region. Top-K per region writes back to a trends cache every minute. The trending list is geofenced because what is trending in Tokyo is rarely trending in Sao Paulo.' },
      { question: 'How would you change this design for an in-house Mastodon-style ActivityPub instance?', answer: 'The fundamentals stay (write fan-out for normal users, hybrid for big accounts, Snowflake IDs, Cassandra tweets table), but the celebrity tier shrinks because federation makes the network smaller per instance. The fan-out worker becomes the outbox processor: instead of writing to local follower timelines, it POSTs ActivityPub Create activities to remote followers\' inboxes over HTTP signatures. Retry on failure becomes a per-target circuit breaker. Inbound activities from remote servers land in your inbox queue, get authenticity-checked, and merged into local timelines. The Redis home timeline structure is unchanged; only the fan-out destination changes from Redis to external HTTP.' },
    ],
  },
  {
    id: 3,
    slug: 'design-instagram',
    title: 'Design Instagram',
    difficulty: 'Hard',
    category: 'Web Services',
    tags: ['media', 'cdn', 'feed', 'storage'],
    problemStatement: `Design Instagram: users upload photos/videos, follow others, and view a personalized feed. Target: 1B users, 100M photo uploads/day, feed loads under 500ms.`,
    requirements: {
      functional: ['Upload photos/videos', 'Follow/unfollow users', 'View personalized feed', 'Like and comment on posts', 'User profile with post grid'],
      nonFunctional: ['Photo upload < 2s', 'Feed load < 500ms', '99.9% availability', 'Petabyte-scale media storage'],
    },
    capacityEstimates: `Uploads: 100M/day ≈ 1,160/sec\nReads: 10× uploads ≈ 11,600 reads/sec\nStorage: 100M × 3MB avg = 300 TB/day\nCDN required to serve media at scale`,
    solutionBreakdown: [
      { section: 'API Design', content: 'Core endpoints, split by what the bytes vs the metadata cost:\n  POST /media/upload-url { content_type, size }  -> { upload_url, media_id }\n  POST /posts { media_ids[], caption, location?, tagged_users[] }  -> 201 { post_id }\n  GET  /feed?cursor=&limit=10  -> { posts[], next_cursor }\n  GET  /users/{handle}/posts?cursor=&limit=12  -> profile grid\n  POST /posts/{id}/like, /posts/{id}/comment\n  POST /follow/{user_id}, DELETE /follow/{user_id}\n\nThe upload-url endpoint mints a presigned PUT against S3, returning a media_id that the client attaches when calling POST /posts. The actual bytes never traverse the API tier.' },
      { section: 'Photo Upload Flow (Direct-to-S3)', content: 'Client requests a presigned URL with the content_type and approximate size. The upload service generates a short-lived (15 min) presigned PUT scoped to one S3 prefix, with a content-length max enforced. The client PUTs the bytes directly to S3 over HTTPS.\n\nOn successful upload, an S3 PutObject event fires through SQS to a processing pipeline. The post creation API is independent — the client calls POST /posts referring to media_ids; if the processing pipeline has not finished yet, the post is created in a PROCESSING state and transitioned to LIVE when the variants are ready.' },
      { section: 'Media Variants and Compression', content: 'Each upload produces multiple variants, written to dedicated S3 prefixes:\n  thumbnail/  150x150  ~10KB  for the profile grid\n  feed/       1080x1080 ~150KB for the feed at standard quality\n  feed_hq/    1080x1080 ~400KB for high-bandwidth devices\n  story/      720x1280  ~250KB for stories\n  original/   untouched (kept for re-encoding when codecs improve)\n\nProcessing runs as a fan-out job: one queue message per variant, parallelised across a worker fleet. Image variants use mozjpeg / WebP / AVIF depending on client Accept header — modern phones can decode AVIF, saving ~30% bandwidth versus JPEG at the same quality.' },
      { section: 'Video Pipeline', content: 'Videos go to a separate transcoding pipeline: split into 2-second HLS segments, transcoded to four bitrate ladders (240p / 480p / 720p / 1080p), and a master HLS manifest is produced. Reels-style short videos prefer H.264 for compatibility; longer videos can use H.265 or AV1 for ~30-40% better compression but require client support.\n\nThumbnail and preview-poster generation happen as part of the same job. Hot-path optimisation: the first frame is encoded and pushed to CDN within a second of upload so users see the post appear in the grid even before transcoding finishes.' },
      { section: 'Post Metadata Store', content: 'Posts in Cassandra, partitioned by user_id, clustered by post_id descending (Snowflake IDs for time-ordering):\n  posts(user_id PK, post_id CK, media_refs jsonb, caption, location_geo, tagged_users list, like_count_cached, comment_count_cached, state, created_at)\n\nThe profile grid is a single-partition slice, identical pattern to Twitter timelines. Reverse-lookup tables (posts_by_id keyed by post_id) for hydration from the feed read path. Tagged users get separate entries in tags_by_user so "posts I am tagged in" is a partition scan, not a global query.' },
      { section: 'Feed Generation — Hybrid Fan-Out', content: 'Same celebrity-aware hybrid as Twitter. For accounts with <100K followers, a fan-out worker pushes (post_id, score=timestamp) into each follower\'s home_feed:{user_id} Redis sorted set. For accounts above the threshold (celebrities, brands), no fan-out — their recent posts live in celeb_recent:{author_id} caches and the reader merges at read time.\n\nInstagram\'s feed is heavily algorithmic, not chronological. The ranking step happens after the merge: collect the candidate post IDs (recent ones from follows), score each one with a lightweight ML model (engagement probability), and return the top-N. Ranking is what makes the feed feel personal — the cache only assembles candidates.' },
      { section: 'Ranking Model', content: 'Two-stage. Candidate retrieval (the steps above) returns ~500 candidate posts per feed load. The ranker scores each with a model that uses ~100 features: time since post, post type (photo/video/carousel/reel), engagement on similar past posts by the user, author affinity (likes/comments/views over the past 30 days), CTR predictions per feature surface.\n\nTraining happens nightly on Spark over a 30-day window of engagement events. Serving uses a feature store (Redis for hot per-user features, an offline store for batch features) so the online ranker only computes the model forward pass, not feature lookup chains. Total candidate-rank latency budget: 100ms.' },
      { section: 'Social Graph', content: 'follows(follower_id PK, followee_id, created_at) with indexes on both columns, horizontally sharded by follower_id. Two hot queries: "who do I follow?" (timeline read) and "who follows me?" (fan-out write).\n\nFollow-graph reads at 11K rps with a P95 of 5ms is feasible from a sharded relational store. Cache the per-user followee list with a 60s TTL — most users do not change who they follow that often. For private accounts, the follow graph is also the access-control list for the post visibility check; this is part of the read path, not optional metadata.' },
      { section: 'Like and Comment Counters', content: 'Like writes go to a Redis HINCRBY counter keyed by post_id, with a periodic flush (every 30s) to Cassandra\'s like_count_cached column. Reads return the optimistic count from Redis or, on cache miss, the persisted value. The exact like count is eventually consistent; UX shows the optimistic increment immediately.\n\nViral posts get hot-row treatment: the API tier micro-batches likes per post_id for 100ms before hitting Redis, collapsing 10K likes into one HINCRBY by N. Comments use a separate Cassandra table partitioned by post_id (each post is a partition) — a long-tail post with 100K comments is paginated by comment_id cursor.' },
      { section: 'Stories and Ephemeral Content', content: 'Stories live 24 hours then disappear. Stored in a separate stories(user_id, story_id, expires_at) table with TTL set on the row. The story feed is computed differently: not personalised ranking, just the unread-stories-from-people-you-follow set, ordered by recency.\n\nView events are tracked per (story_id, viewer_id) so the author sees the viewer list. View events go to Kafka and roll up to a per-story HSCAN-cached set with the TTL aligned to expiry, then both deleted at expiry. This keeps the view-list storage bounded — once the story expires, the view data is gone too.' },
      { section: 'Direct Messages', content: 'DMs are not part of the feed system. They live in a separate conversation store partitioned by conversation_id (sorted set of (sender, receiver) hashes), with messages clustered by message_id descending — same pattern as a chat app.\n\nIncluded here because DM media (photos sent in chats) shares the same S3 upload pipeline as feed posts. The difference: DM media has stricter ACL (only the conversation participants can fetch), so the CDN signed URLs are scoped per-conversation and short-lived (15 min).' },
      { section: 'Search and Discovery', content: 'Hashtags, captions, and location tags index into Elasticsearch via CDC from Cassandra. The Explore tab is a different problem — it is collaborative-filtering recommendations of posts the user has not seen, filtered by interest signals. Explore candidates come from an offline batch job over engagement events; the online serve is just a fetch from a per-user Redis list refreshed every 6 hours. This is cheaper than per-request ranking and the latency is dominated by image hydration, not candidate generation.' },
      { section: 'Failure Modes and Recovery', content: 'S3 upload fails mid-PUT: client retries with the same media_id (presigned URL still valid until TTL expiry). If the URL expired, request a fresh one. The post creation tolerates "media not ready" and stays in PROCESSING until the variants arrive or a timeout (10 min) elapses, after which the post is dropped and the user is notified.\n\nFan-out worker lag: timeline reads detect cache miss against the user\'s home feed and fall back to "pull from followees" mode, which is slower but available. Backfill from Cassandra hot-tweet caches in the background.\n\nCDN origin outage: clients carry cached image URLs for ~24h and the CDN serves them from edge storage. New uploads fail. Auto-failover to a secondary CDN region; the cost is potential cache misses while warm-up happens.\n\nRanking model degraded: fall back to chronological ordering on the merged candidates. The feed is still useful, just less engaging.' },
      { section: 'Observability', content: 'Key SLIs:\n  feed_load_latency_p99 (alert > 500ms)\n  upload_completion_rate (alert < 99%)\n  image_processing_lag_seconds (alert > 30s)\n  cdn_cache_hit_ratio (alert < 95%)\n  ranking_model_p99 (alert > 50ms)\n  fanout_queue_lag (alert > 60s)\n\nEvery post emits a structured event with post_id, author_id, media_count, processing_durations per variant. Engagement events (likes, comments, view durations) feed both the analytics warehouse and the online ranking feature store. Every feed read writes a trace to the ranking analytics stream so the ML team can A/B test ranking changes offline against held-out reads.' },
      { section: 'Scaling Levers', content: 'Three main cost lines: media bytes (CDN + S3), fan-out compute, ranking compute.\n\nMedia cost dominates — push more aggressive client-side compression and modern codecs (AVIF, AV1) to halve egress. Stories expire data so their cost is bounded.\n\nFan-out cost scales linearly with average follower count. The lever is the celebrity threshold: lowering it from 100K to 10K cuts write amplification but adds merge load to reads. Re-tune quarterly based on actual fanout-bytes-per-tweet metrics.\n\nRanking compute is per-feed-load. Cache rankings for 30 seconds per user — re-ranking on every scroll wastes GPU. For users who scroll past the cache, re-rank with fresh signals; for fast scrollers, paginate over the cached ranking.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Web[Web App]
        Mobile[Mobile App]
    end
    subgraph Edge
        CDN[CloudFront CDN]
    end
    subgraph Gateway
        APIGW[API Gateway]
        Auth[Auth Service]
    end
    subgraph Services
        UploadSvc[Upload Service]
        FeedSvc[Feed Service]
        PostSvc[Post Metadata Svc]
        FollowSvc[Follow Graph Svc]
        LikeSvc[Like Service]
        CommentSvc[Comment Service]
        ProfileSvc[Profile Service]
        NotifSvc[Notification Svc]
        SearchSvc[Search Service]
    end
    subgraph Async
        SQS[SQS Queue]
        ImgProc[Image Processor]
        VidProc[Video Transcoder]
        FanoutW[Feed Fan-out Worker]
        Indexer[Search Indexer]
        Counter[Like Counter Flusher]
    end
    subgraph Storage
        S3[(S3 Media)]
        PostDB[(Posts Cassandra)]
        FeedCache[(Feed Cache Redis)]
        GraphDB[(Follow Graph DB)]
        LikeRedis[(Like Counters Redis)]
        CommentDB[(Comments DB)]
        UserDB[(User DB)]
        ES[(Elasticsearch)]
    end
    subgraph Analytics
        EventBus[Kafka Events]
        Lake[(Data Lake)]
    end

    Mobile -->|presigned URL request| APIGW --> Auth
    APIGW --> UploadSvc
    UploadSvc -->|presigned PUT| Mobile
    Mobile -->|direct upload| S3
    S3 -->|object event| SQS
    SQS --> ImgProc --> S3
    SQS --> VidProc --> S3
    ImgProc --> PostSvc --> PostDB
    PostSvc -->|fan-out| FanoutW
    FanoutW --> FeedCache
    FanoutW -->|celebrity skip| PostDB

    Mobile -->|GET feed| APIGW --> FeedSvc
    FeedSvc --> FeedCache
    FeedSvc -->|celebrity merge| PostDB
    Mobile -->|view media| CDN
    CDN -->|origin| S3

    Web -->|like| APIGW --> LikeSvc --> LikeRedis
    LikeRedis --> Counter --> PostDB
    Web -->|comment| APIGW --> CommentSvc --> CommentDB

    Web -->|follow user| APIGW --> FollowSvc --> GraphDB
    FollowSvc --> NotifSvc --> Mobile
    APIGW --> ProfileSvc --> UserDB
    Web -->|search| APIGW --> SearchSvc --> ES

    PostSvc --> EventBus
    EventBus --> Indexer --> ES
    EventBus --> Lake

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class S3,PostDB,FeedCache,GraphDB,LikeRedis,CommentDB,UserDB,ES storage
    class SQS,ImgProc,VidProc,FanoutW,Indexer,Counter async
    class CDN edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Direct S3 upload vs proxy through API', rationale: 'Direct upload via presigned URL keeps multi-megabyte image bytes off the API tier entirely — at 1,160 uploads/sec averaging 3MB each, proxying would consume hundreds of GB/sec of API bandwidth. The trade-off is less control mid-upload: virus scan and content moderation run after the bytes land in S3 rather than inline. For consumer photo platforms the bandwidth saving is worth the slight delay before processed content is visible.' },
      { decision: 'Pre-generate all media variants vs on-the-fly resize', rationale: 'Pre-generating four sizes (thumbnail, feed, feed_hq, story) costs storage but lets the CDN serve straight from S3 with no compute. On-the-fly resize at the edge (via Lambda@Edge or image-resize CDN features) saves storage but adds per-request compute, which is expensive at 11K rps. Pre-generate for predictable usage patterns; reserve on-the-fly resize for the long tail of uncommon variants.' },
      { decision: 'Chronological feed vs ranked feed', rationale: 'Chronological is what users say they want and is cheap to compute. Ranked feeds drive significantly more engagement at the cost of ~50ms per feed load and a continuous training pipeline. Almost every consumer feed product has moved to ranked; the engagement lift pays for the infrastructure many times over. The user setting "show in chronological order" is real but is a niche escape hatch.' },
      { decision: 'Hybrid fan-out threshold (100K followers)', rationale: 'Lower the threshold and you spend less on fan-out writes but more on read-time merges; raise it and you pay more for celebrity tweets but reads stay simple. The right number depends on the read/write ratio and the cost of a Redis ZADD vs an extra read-time cache call. Reassess quarterly — as the user base grows the median follower count shifts.' },
      { decision: 'Cassandra vs PostgreSQL for posts', rationale: 'Cassandra handles 1,160 wps cleanly, scales linearly with nodes, and partitions posts by user_id which matches the profile-grid read pattern perfectly. Postgres needs explicit sharding once you exceed a single primary and the profile-grid query is awkward across shards. For a write rate climbing past ~5K wps with predictable partition reads, Cassandra is the obvious pick.' },
    ],
    keyTakeaways: [
      'Presigned S3 uploads keep multi-MB image bytes off the API tier — the API only ever sees small JSON payloads',
      'Pre-generating multiple variants at upload time trades storage for CDN-friendly serving with zero per-request compute',
      'Ranked feeds beat chronological feeds on engagement, but require a candidate-retrieval pipeline and online ranking model that adds ~50ms per feed load',
      'The hybrid fan-out strategy from Twitter applies directly to Instagram; the celebrity threshold is the single biggest cost-tuning knob',
      'Stories and posts have completely different storage and lifecycle requirements; do not try to unify them into one feed pipeline',
      'CDN cache hit ratio is the canary metric — every percentage point below 95% adds noticeable cost and latency at petabyte scale',
    ],
    faqs: [
      { question: 'Why pre-generate four image variants instead of resizing on the fly at the CDN?', answer: 'At 11K reads/sec, on-the-fly resize means tens of thousands of resize ops per second running in CDN compute. That is expensive (much more than S3 storage) and adds latency to every cache miss. Pre-generating four variants at upload time (a one-time cost) lets the CDN serve straight from S3 with zero compute on the request path. The trade-off: every new variant size requires backfilling existing images. Most products live with four sizes for a long time precisely to avoid backfill.' },
      { question: 'How do you handle the case where a post is created before its media finishes processing?', answer: 'The post lands in state=PROCESSING immediately on POST /posts. The client gets a 201 back with the post_id but the feed pipeline does not fan it out yet. When the image processor publishes all variants, an event flips the post to LIVE which triggers the fan-out. Users see their own profile grid show the post (in PROCESSING state, possibly with a low-res preview) but it does not appear in followers\' feeds until LIVE. If processing fails after 10 minutes, the post is auto-deleted and the user is notified. This decoupling keeps the upload UX fast while protecting feed integrity.' },
      { question: 'How does the ranking model serve at 11K reads/sec without melting GPUs?', answer: 'A few things work together. First, the candidate set is small (~500 posts per feed load, not the whole post universe). Second, the model is a gradient-boosted tree, not a giant neural net — runs on CPU in ~20ms per request. Third, features come pre-computed: the feature store has per-user and per-post features refreshed hourly or on-event, so the online path only does feature lookups and a forward pass. Fourth, results cache for 30 seconds per user so a feed scroll re-uses the ranking instead of recomputing. The combined effect is that ranking compute is dominated by feature lookups, not the model itself.' },
      { question: 'Why are comments stored separately from posts instead of inline?', answer: 'Inline comments would blow up the post row for viral posts — a post with 100K comments would be tens of megabytes, dragging every read of the post. Cassandra rows have a soft size limit and unbounded growth wrecks compaction. Storing comments in a separate table partitioned by post_id (each post is one partition, comments clustered by comment_id) gives you pagination, bounded reads, and lets the post row stay small for the common case. The trade-off is two reads instead of one to load a post and its first few comments — easy to parallelise.' },
      { question: 'How do you fan out a post from someone with 5 million followers without taking forever?', answer: 'Five million is above the celebrity threshold so it skips fan-out entirely. The post lives in the author\'s celeb_recent:{author_id} cache only; readers merge it at read time. If the user is on the boundary (say 200K followers) and you do fan out, the worker partitions follower IDs across many Kafka workers (each handling a batch of 10K followers) and the writes parallelise across the Redis cluster. Total wall-clock time is in the seconds — followers see the post within seconds of posting, which is well within user tolerance for "near real-time."' },
      { question: 'What happens to story view-state when the story expires?', answer: 'Both the story and its view list are TTL\'d to the same expiry timestamp (24h from creation). When the TTL fires, Redis evicts the keys; the cold-storage backing in Cassandra also has TTL set on the row. The author sees an empty viewer list once the story expires — by design. If the product wants historical view data, you would emit per-view events to Kafka before expiry, but the feature store and main path stay bounded by the 24h window. The bound on storage is what makes stories cheap to run at billion-user scale.' },
      { question: 'Why HLS for videos but not for images?', answer: 'HLS exists to switch bitrates mid-playback based on network conditions — a problem only video has because video is a stream over time. Images are one-shot fetches; you pick the right variant for the device at the start (based on screen size and connection type) and serve it. The mobile client decides between feed/ vs feed_hq/ at the moment of the request, using the same Accept-Encoding and connection-type signal it would use for a video bitrate decision. Implementing image HLS would add complexity for no user-visible benefit.' },
      { question: 'How do you stop the feed from showing the same post twice (once chronological, once from a re-share)?', answer: 'The ranker dedupes on (canonical_post_id) — every re-share carries a reference to the original post_id. After candidate retrieval but before ranking, the candidate list is uniqued on canonical_post_id, keeping the highest-affinity surface (e.g., a re-share by a close friend wins over the original from an account you barely interact with). The user sees one card per underlying post, attributed to the surface most likely to engage them. Without this step you would see duplicates from your tightly-overlapping social circle.' },
      { question: 'Is there ever a case for storing media bytes in the database rather than S3?', answer: 'For Instagram-scale photo platforms, no. Databases are not optimised for blob storage — every read drags the bytes across the same connection pool that serves metadata, replication is expensive, and you cannot easily put a CDN in front. The split (metadata in Cassandra, bytes in S3) lets you scale each independently and lets the CDN absorb 95% of read traffic. The only reason to inline is when bytes are tiny (a few KB) and ACL is tightly coupled to the row — for example, encrypted DM payloads in some chat systems. For megabyte-scale media, always store separately.' },
      { question: 'How would the design change for a privacy-first Instagram clone with end-to-end encrypted DMs?', answer: 'The feed and post storage stay the same — public posts are by definition not encrypted to specific recipients. The DM side changes substantially: the upload pipeline encrypts media with a symmetric key on the client before PUT to S3; the key is wrapped to each recipient\'s public key via the existing E2E messaging protocol (Signal, MLS). The server only ever sees opaque bytes and per-recipient wrapped keys. The CDN cannot transform the media (no resize) so you ship multiple sizes from the client. Performance degrades for DM media (no CDN-side optimisation) but post media is unaffected.' },
    ],
  },
  {
    id: 4,
    slug: 'design-rate-limiter',
    title: 'Design a Rate Limiter',
    difficulty: 'Medium',
    category: 'Web Services',
    tags: ['rate-limiting', 'redis', 'distributed', 'algorithms'],
    problemStatement: `Design a rate limiter that restricts the number of requests a client can make to an API within a time window. Support multiple algorithms. Must work in a distributed environment with multiple API server instances.`,
    requirements: {
      functional: ['Limit requests per user/IP per time window', 'Return HTTP 429 when limit exceeded', 'Support different limits per API endpoint', 'Configurable window size and request count'],
      nonFunctional: ['Latency overhead < 5ms', 'Accurate across distributed servers', 'Handle bursts gracefully'],
    },
    capacityEstimates: `Rate limiter decision per request: ~1ms Redis call\nRedis key per user: user_id + window (e.g., "user:123:2024-01-01-14")\nMemory: 1M users × 100B per key = 100MB`,
    solutionBreakdown: [
      { section: 'Where the Rate Limiter Sits', content: 'A rate limiter is a middleware that runs as early as possible in the request pipeline — typically at the API gateway, before auth fan-out and certainly before any business logic. Running it after auth wastes capacity on requests you are about to reject; running it at the gateway also lets you reject DDoS-shaped traffic before it touches application services.\n\nThe limiter takes (identity, route) and returns ALLOW or DENY plus a remaining-budget and reset timestamp. Identity is whatever you want to rate-limit on: API key, user_id, IP, or a composite (user_id + endpoint). The decision must complete in <5ms so it does not dominate request latency.' },
      { section: 'Token Bucket Algorithm', content: 'Each (identity, route) has a bucket with capacity C and refill rate R tokens/second. Each request consumes one token. If the bucket is empty, reject with 429.\n\nStored as two values per identity: tokens_remaining and last_refill_at. On each request:\n  now = current_time()\n  tokens_to_add = (now - last_refill_at) * refill_rate\n  tokens = min(capacity, tokens_remaining + tokens_to_add)\n  if tokens >= 1:\n    tokens -= 1; last_refill_at = now; return ALLOW\n  else:\n    return DENY\n\nMust be atomic to avoid races. Implemented as a Redis Lua script (single round-trip, atomic) keyed by identity.\n\nToken bucket allows bursts (instantaneously up to C requests) while enforcing average rate R — the right shape for human-facing APIs where short bursts are normal.' },
      { section: 'Sliding Window Log', content: 'Most accurate but most expensive. Store a sorted set of timestamps per identity in Redis. On each request:\n  ZADD identity timestamp timestamp\n  ZREMRANGEBYSCORE identity 0 (now - window)\n  count = ZCARD identity\n  if count > limit: return DENY else return ALLOW\n\nO(log N) per call. Memory grows with traffic — 1000 requests in the window = 1000 sorted-set entries per user. At very high RPS the memory cost is real. Use when you need exact accuracy and the request rate per identity is bounded (e.g., per-user limits, not per-IP under DDoS).' },
      { section: 'Sliding Window Counter (Hybrid)', content: 'A practical hybrid that approximates the log without storing every timestamp:\n  current_count = INCR identity:current_minute\n  previous_count = GET identity:previous_minute\n  weight = (60 - seconds_into_current_minute) / 60\n  approximate_rate = previous_count * weight + current_count\n  if approximate_rate > limit: return DENY\n\nTwo Redis ops per request, constant memory, smooth across window boundaries (no 2x burst at the edge). The approximation is within ~1% of the true count for steady traffic. This is what most production systems actually use.' },
      { section: 'Fixed Window Counter', content: 'The simplest:\n  INCR identity:floor(now / window)\n  EXPIRE identity:floor(now / window) window\n\nOne Redis op. The famous failure: a user can hit the limit at second 59 of one window and again at second 1 of the next, double-spending the budget. For coarse limits (5,000 requests per hour) this is tolerable. For tight limits (10 requests per minute) it lets through 2x for one second per window.\n\nFine for non-abusive identities; bad for abuse mitigation.' },
      { section: 'Leaky Bucket', content: 'A queue with a fixed drain rate. Requests entering a full queue are dropped. Enforces a constant output rate regardless of input burst.\n\nUseful when the downstream system has a hard throughput cap (e.g., a payment processor that accepts exactly 100 rps). The user experience is worse than token bucket — bursts are dropped rather than served immediately — but the downstream protection is absolute.\n\nMost commonly implemented as a token bucket variant; the distinction matters more in network gear than in application rate limiters.' },
      { section: 'Distributed Coordination', content: 'Multiple API gateway instances share rate-limit state. Three architectures:\n\n  1. Centralised Redis — every request hits a shared Redis. Atomic, exact, adds 1-3ms per request. The standard pick.\n  2. Per-instance counters with periodic sync — each gateway tracks counts locally and pushes deltas to Redis every 1-5 seconds. Fast (no per-request Redis call) but allows N x limit transient over-spend where N is the number of gateways.\n  3. Sticky routing — each identity always routes to the same gateway by consistent hash. State is local, no Redis needed, but rebalancing on gateway add/remove causes brief over-spend.\n\nFor most APIs, centralised Redis is the answer. The latency cost is small and the correctness is exact.' },
      { section: 'Multi-Tier Limits', content: 'Real APIs enforce multiple limits per request:\n  per-IP rate limit (DDoS defence)\n  per-API-key rate limit (fairness across customers)\n  per-endpoint rate limit (protect specific expensive routes)\n  per-organisation quota (monthly billing tier)\n\nEvery request increments multiple keys. If any one is over, reject. The most expensive limit usually wins — order the checks cheap-to-expensive (in-memory IP check, then Redis API-key check, then Redis quota check) so most rejections short-circuit early.' },
      { section: 'Rate Limit Response Headers', content: 'Every response (allow or deny) carries:\n  X-RateLimit-Limit: 1000  (the bucket capacity)\n  X-RateLimit-Remaining: 847  (current tokens)\n  X-RateLimit-Reset: 1640995200  (Unix timestamp when full again)\n  Retry-After: 23  (seconds, on 429 responses only)\n\nWell-behaved clients use these to self-throttle, smoothing traffic instead of bursting until rejected. The standard HTTP 429 status code carries Retry-After in the recommended way. Some APIs also use 503 with Retry-After during planned overload; semantically 429 is correct for rate limiting specifically.' },
      { section: 'Storage Choice and Memory', content: 'Redis is the default — atomic ops, TTLs, low latency. Key structure: rl:{algo}:{identity}:{window_or_route} keeps namespaces clean. Memory math:\n  Token bucket: ~50 bytes per identity (two numbers + key). 10M users = 500MB.\n  Sliding window counter: ~100 bytes per identity (two counters + key). 10M = 1GB.\n  Sliding window log: variable. 1K req/window x 8B per timestamp x 10M users = unworkable for high-traffic.\n\nUse Redis Cluster for horizontal scaling — partition keys by identity. Cluster mode adds one network hop for cross-slot operations; with thoughtful key naming this is rare. For multi-region setups, run a Redis cluster per region; do not cross-replicate rate-limit state because the latency would defeat the purpose.' },
      { section: 'Failure Modes — Fail Open or Fail Closed', content: 'When Redis is down or slow, the limiter must decide: fail open (allow the request) or fail closed (deny everything).\n\nFail open is what most public APIs do: a Redis outage degrades to no rate limiting rather than total outage. The risk: a coordinated attacker can spot the Redis outage and burst. Mitigate with a circuit breaker that falls back to a per-instance in-memory limiter — coarser but still bounded.\n\nFail closed is correct when rate limiting is a security control (anti-abuse, anti-fraud). A payment API should refuse rather than allow unbounded retries during a Redis outage. Decide explicitly per endpoint, not platform-wide.' },
      { section: 'Configuration and Dynamic Limits', content: 'Limits are config, not code. A config service (etcd, Consul, Redis hash) holds {api_key -> {endpoint -> limit}} and the gateway watches for changes. New limits take effect within seconds without redeploy.\n\nLimits should be expressed as rate + burst (e.g., 100 rps sustained, 200 burst), not just rate, so token bucket can be tuned independently of allow-bursts policy. Per-customer overrides for enterprise tiers — the config layer is where billing tier meets enforcement.' },
      { section: 'Observability', content: 'Per-second metrics:\n  rate_limit_decisions_total {decision=allow|deny, algo, route, identity_class}\n  rate_limit_redis_latency_p99 (alert > 5ms)\n  rate_limit_redis_error_rate (alert > 0.1%, signals fail-open is active)\n  top_n_rate_limited_identities (signals attack or specific bad client)\n\nLog every 429 with identity, route, current count, and limit so customer support can debug "why am I being rate limited" without reproducing the issue. Per-identity dashboards let you spot abuse patterns — a single API key churning through 100x the typical request rate is either an attack or a misconfigured client.' },
      { section: 'Anti-Abuse Patterns', content: 'Beyond steady-state rate limits, abuse defence layers:\n  Increasing penalties — second-strike 429s carry doubled Retry-After. Third strike triggers a short ban.\n  CAPTCHA on suspicious clients — IPs over the rate limit a few times get a CAPTCHA challenge instead of an immediate 429.\n  Distributed reputation — hand off identities (IPs, API keys) to a reputation service that aggregates signals across the fleet. Persistent abusers get tighter limits before they even hit the steady-state threshold.\n  Tarpit — for known-bad clients, accept the connection and slow-respond instead of 429 (delays the attack without revealing the limit).' },
      { section: 'Scaling Levers', content: 'Three lever groups:\n\n  Throughput: shard Redis Cluster by identity prefix; add nodes when ops/sec approaches Redis-node ceiling (~50K ops/sec per node). Each gateway pools connections.\n\n  Latency: cache the rate-limit config in-process so the per-request hot path is one Redis op. Co-locate the Redis cluster in the same AZ as the gateways — cross-AZ adds 1-2ms.\n\n  Global: for multi-region APIs, prefer per-region limits over a single global limit. Global limits require cross-region coordination (CRDTs or a single-leader sync) and cost is rarely worth the exactness.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Web[Web Client]
        Mobile[Mobile Client]
        API3rd[Third Party API Caller]
    end
    subgraph Edge
        LB[Load Balancer]
    end
    subgraph Gateway
        APIGW[API Gateway]
        Middleware[Rate Limit Middleware]
        AuthSvc[Auth Service]
    end
    subgraph Services
        TokenBucket[Token Bucket Algo]
        SlidingLog[Sliding Window Log Algo]
        FixedWin[Fixed Window Counter Algo]
        ConfigSvc[Limit Config Service]
        Handler[Request Handler]
        Deny[429 Response Builder]
        Headers[Rate Limit Header Injector]
    end
    subgraph Async
        SyncJob[Local to Central Sync Job]
        LogShipper[Decision Log Shipper]
    end
    subgraph Storage
        RedisCluster[(Redis Cluster Shared State)]
        LocalCache[(Local In-Process Counter)]
        ConfigDB[(Limit Config DB)]
    end
    subgraph Analytics
        Kafka[Kafka Decision Events]
        Lake[(Data Lake)]
    end

    Web -->|request| LB --> APIGW
    Mobile -->|request| LB
    API3rd -->|request| LB
    APIGW --> AuthSvc
    APIGW --> Middleware
    Middleware --> ConfigSvc --> ConfigDB

    Middleware -->|per user burst| TokenBucket
    Middleware -->|accurate window| SlidingLog
    Middleware -->|simple counter| FixedWin
    TokenBucket -->|INCR and TTL| RedisCluster
    SlidingLog -->|ZADD ZREMRANGEBYSCORE| RedisCluster
    FixedWin --> RedisCluster
    TokenBucket --> LocalCache
    LocalCache --> SyncJob --> RedisCluster

    Middleware -->|allow| Handler
    Middleware -->|deny| Deny
    Handler --> Headers
    Deny --> Headers
    Headers --> Web
    Headers --> Mobile
    Headers --> API3rd

    Middleware --> Kafka --> LogShipper --> Lake

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class RedisCluster,LocalCache,ConfigDB storage
    class SyncJob,LogShipper async
    class LB edge
    class Kafka,Lake analytics`,
    tradeoffs: [
      { decision: 'Token bucket vs sliding window counter', rationale: 'Token bucket explicitly models "allow bursts up to C, then trickle at R" which matches how humans use APIs — bursty UI clicks followed by quiet. Sliding window counter is smoother and approximates exact rate without bursts. Pick token bucket when you want to be friendly to legitimate burst patterns; pick sliding window when fairness over an exact window matters (e.g., quota-based billing).' },
      { decision: 'Centralised Redis vs per-instance in-memory counters', rationale: 'Centralised Redis gives exact limits at the cost of 1-3ms per request and a single point of failure to engineer around. Per-instance counters are faster (no network call) but allow N x limit transient over-spend where N is the gateway count, and require periodic sync to converge. Use centralised Redis for billing-critical limits; use per-instance counters for soft DDoS protection where small inaccuracy is fine.' },
      { decision: 'Fail open vs fail closed during Redis outage', rationale: 'Fail open keeps the API available when the rate limiter dies — appropriate for public APIs where availability beats perfect rate enforcement. Fail closed treats rate limiting as a security control and refuses to operate without it — appropriate for endpoints where an unbounded burst would corrupt state (payment retries, account creation). Decide per endpoint, not platform-wide.' },
      { decision: 'Global limits vs per-region limits in multi-region deployments', rationale: 'Global limits require cross-region coordination — either a leader-elected counter or CRDT-style approximation — both of which add tens of milliseconds and complexity. Per-region limits give you N x the global limit (one allotment per region) but every region operates independently and fast. Pick per-region unless the rate limit is tied to a downstream resource that is itself global (a global billing quota).' },
      { decision: 'Single limit vs multi-tier limits per request', rationale: 'Single per-API-key limit is simple but lets one expensive endpoint exhaust the user\'s budget, blocking access to all other endpoints. Multi-tier (per-IP, per-key, per-endpoint, per-quota) gives finer protection but multiplies per-request Redis ops. Order checks cheap-to-expensive so 90% of rejections short-circuit before hitting Redis. The added Redis cost is worth it for any API with diverse endpoint costs.' },
    ],
    keyTakeaways: [
      'Token bucket and sliding window counter are the two algorithms you should know cold; everything else is a variation',
      'Redis with atomic Lua scripts is the default backing store — anything less than atomic admits races that undercount',
      'Rate limit response headers (X-RateLimit-*, Retry-After) let well-behaved clients self-throttle and dramatically reduce reject rates',
      'Multi-tier limits (per-IP + per-key + per-endpoint) protect against each abuse pattern; a single limit always has a workaround',
      'Fail-open vs fail-closed is a deliberate decision per endpoint, not a default — get it wrong and a Redis outage either takes you down or admits an attack',
      'Per-region limits in multi-region deployments are almost always the right answer; global limits force cross-region coordination that defeats the speed argument',
    ],
    faqs: [
      { question: 'Why is Lua scripting the standard implementation for token-bucket in Redis?', answer: 'Token bucket reads two values, computes new values, and writes them back. Doing this with discrete GET/SET commands has a race: two concurrent requests both read the same tokens_remaining and both write tokens_remaining - 1, double-spending. A Lua script runs atomically inside Redis — the read, compute, and write all happen as one operation visible to other clients only after completion. The script is also one round-trip, so latency is constant regardless of bucket complexity. Every production rate limiter in Redis is implemented as a Lua script for this reason.' },
      { question: 'How do you stop someone from circumventing per-user limits by spinning up sock-puppet accounts?', answer: 'Layer the limits. A per-user limit catches per-account abuse, but you also need a per-IP limit (catches puppet-creation from one host) and a per-payment-method or per-device-fingerprint limit (catches puppet-creation across IPs). For sophisticated attackers, build a reputation system: track signals (signup time, device anomaly, payment failures) and feed them into a risk score that tightens limits for risky identities. The limit itself is just a knob; the work is in choosing the right identity to apply it to.' },
      { question: 'What does the 2x burst at fixed-window boundaries actually look like?', answer: 'Suppose the limit is 10 requests per minute, fixed window. At time 0:59 the user has used 10 of 10 in the current window — they get 9 successful requests. At time 1:00 the new window starts and the counter resets; they can immediately fire 10 more. Net effect: 20 requests in one second, halfway through a "1 minute" window. For tight limits this is a real abuse vector. Sliding window counter or token bucket both fix this; sliding window log fixes it most precisely.' },
      { question: 'Should you rate-limit by IP, by user, or by API key?', answer: 'All three, in different ways. By IP at the very front of the pipeline as a coarse DDoS defence — a single IP firing 10,000 rps is almost certainly hostile regardless of what API key it carries. By API key for fairness — a customer\'s key gets their contracted quota, no more. By user_id when the action affects per-user state (e.g., posting tweets) and a single API key serves many users. The trick is that rate limiting per-IP can punish CGNAT customers and corporate offices where many users share an IP, so per-IP limits should be relatively loose and used as outlier detection, not primary enforcement.' },
      { question: 'How do you communicate rate limits to clients so they cooperate?', answer: 'Headers on every response: X-RateLimit-Limit (the quota), X-RateLimit-Remaining (how many calls left in this window), X-RateLimit-Reset (when the bucket refills). On a 429 response, also Retry-After (seconds to wait before retrying). SDKs read these headers and back off automatically — the request rate self-smooths. Well-designed APIs also publish per-endpoint limits in documentation. The result: well-behaved clients rarely see 429s because they slow down before the limit hits, and the rate limiter becomes about catching the misbehaving clients.' },
      { question: 'What happens if Redis goes down — fail open or fail closed?', answer: 'It depends on the endpoint. Public read APIs should fail open: a Redis outage is your problem, not the customer\'s, and rejecting all traffic during an outage doubles the incident. Use a circuit breaker that falls back to a coarse per-instance in-memory limiter as a safety net. Security-sensitive endpoints (login, payment, account creation) should fail closed: an attacker can detect Redis is down and try to brute-force, and the cost of letting them through outweighs the availability hit. Decide explicitly per route and document the choice.' },
      { question: 'How do you handle a customer who suddenly needs 10x their quota for a launch?', answer: 'Limits as config, not code. The rate-limit middleware reads its limits from a config store (Redis hash, Consul KV, etcd) and watches for changes. Customer support raises the limit in the config and the change is live within seconds. Build per-customer overrides into the config schema from day one — every API hits this case eventually. Auto-expiry on temporary overrides (e.g., "give 10x for 48 hours, then revert") prevents permanent looseness from accumulating.' },
      { question: 'Is the sliding window counter actually accurate enough?', answer: 'It is an approximation: it assumes the previous window\'s requests were uniformly distributed in time, which is rarely exactly true. In practice the approximation error is under 1% for steady traffic and a few percent for very bursty traffic. For non-abuse use cases (most rate limiting) this is fine. For billing-critical quotas where you must not let through even one extra request, use sliding window log. For limiting "10 free requests per month" you can use a token bucket with a refill rate of 10/month — the algorithm is the same shape.' },
      { question: 'Where should the rate limiter actually run — gateway, sidecar, or in-app?', answer: 'At the API gateway, as early as possible. Running it in-app wastes capacity on requests you are about to reject, and means every service replicates the rate-limit logic. Running it as a sidecar adds a network hop. The gateway is where auth, routing, and rate limiting share infrastructure naturally. The exception: business-rule rate limits (e.g., "this user can place 3 orders per day") need application-level data and live in the relevant service. Distinguish the API rate limit (HTTP traffic protection at the gateway) from the business limit (semantic constraint in the service).' },
      { question: 'How does this design extend to GraphQL or other non-HTTP-request-counted APIs?', answer: 'Counting requests is the wrong unit for GraphQL — a single request can be cheap (one field) or extremely expensive (deeply nested query traversing the entire graph). The limiter shifts from request-count to cost-count: every query is statically analysed for an expected cost (sum of field weights), and the cost is consumed from the bucket. Cheap queries get many; expensive queries get few. The token-bucket implementation is the same; what changes is the cost computed per request. The same idea applies to LLM APIs where you bill per token: the limiter consumes tokens-in plus tokens-out from the bucket instead of request count.' },
    ],
  },
  {
    id: 5,
    slug: 'design-api-gateway',
    title: 'Design an API Gateway',
    difficulty: 'Medium',
    category: 'Web Services',
    tags: ['api-gateway', 'routing', 'auth', 'load-balancing'],
    problemStatement: `Design an API Gateway that acts as the single entry point for all client requests in a microservices architecture. It should handle routing, authentication, rate limiting, and load balancing.`,
    requirements: {
      functional: ['Route requests to appropriate microservices', 'Authenticate and authorize requests via JWT/API keys', 'Rate limit per client', 'Request/response transformation', 'SSL termination'],
      nonFunctional: ['< 10ms added latency', '99.99% availability', 'Handle 500K rps', 'Horizontal scalability'],
    },
    capacityEstimates: `500K rps across gateway nodes\nEach gateway node: ~50K rps (10 nodes)\nAuth cache: JWT public keys cached in-process\nRouting table: loaded from config service, ~100KB`,
    solutionBreakdown: [
      { section: 'What the Gateway Is For', content: 'The API gateway is the single ingress for client traffic in a microservices system. It owns the cross-cutting concerns that every service would otherwise implement separately: TLS termination, authentication, rate limiting, request routing, load balancing, request/response transformation, and observability collection.\n\nWhy concentrate them here? Two reasons. First, doing them once at the edge means each backend service does not have to. Second, the gateway is the natural place to enforce policy that applies to clients (rate limits, auth) versus services (circuit breakers, retries). The line "what is client-facing vs service-internal" is the line the gateway draws.' },
      { section: 'Request Pipeline', content: 'Each request flows through a stack of middlewares in a fixed order:\n  1. TLS termination (decrypt)\n  2. Request validation (header presence, body size)\n  3. Authentication (JWT, API key, mTLS)\n  4. Rate limiting (per-IP, per-key, per-endpoint)\n  5. Authorisation (scope/role checks)\n  6. Routing decision (which backend pool)\n  7. Request transformation (header injection, field filtering)\n  8. Load balancing + dispatch\n  9. Response transformation (header stripping, error normalisation)\n  10. Logging + metrics emission\n\nEarly stages fail fast: an invalid TLS hello rejects before parsing, an unsigned JWT rejects before rate limiting, a rate-limit reject never reaches the backend. The ordering matters for both correctness and cost.' },
      { section: 'Authentication — JWT', content: 'JWTs carry their own signature; verifying them is local computation (no DB call) given the issuer\'s public key. The gateway maintains an in-process cache of issuer public keys, refreshed every ~10 minutes from the auth service\'s JWKS endpoint.\n\nVerification steps per request:\n  1. Parse the JWT, extract kid (key ID) from header.\n  2. Look up the cached public key for kid; if missing, fetch from JWKS and cache.\n  3. Verify signature using the public key (RS256 or ES256 are standard).\n  4. Validate exp (expiration), nbf (not-before), iss (issuer), aud (audience).\n  5. Extract claims (sub, scope, custom) and attach to the request context for downstream services.\n\nNo DB call on the hot path; rejected JWTs never enter the rate-limit accounting bucket. Aim for <1ms total in the middleware.' },
      { section: 'Authentication — API Keys and mTLS', content: 'For non-OAuth callers (service-to-service, partner integrations), API keys or mTLS:\n\n  API keys: client sends Authorization: Bearer apk_xyz. Gateway hashes the key and looks it up in an in-memory hash set refreshed from Redis every 30 seconds. Per-key metadata (customer_id, scopes, rate limits) is attached to the context. Revocation: delete from Redis; in-memory set re-syncs within 30 seconds. For instant revocation, push a key-revocation event to all gateways via pub/sub.\n\n  mTLS: client presents a certificate signed by a trusted CA. The gateway terminates TLS, validates the cert chain, and identifies the client by certificate subject. Used between trusted services (internal partners, banks) where pre-shared keys are too risky.' },
      { section: 'Routing and Service Discovery', content: 'A route table maps (host, path_pattern, method) to backend service pools. Loaded at startup from a service registry (Consul, etcd, Kubernetes API) and updated via watch notifications — no gateway restart required.\n\nFor each route, the gateway knows: which backend pool, the load balancing strategy, request/response transformations, retry policy, timeout, and circuit breaker settings. Route lookup is a trie or radix tree on the path — O(log N) for hundreds of routes.\n\nDynamic config (canary deploys, A/B splits) goes through the routing layer: route 5% of traffic with header X-Beta:true to the canary pool. The control plane pushes config; the gateway reloads atomically without dropping in-flight requests.' },
      { section: 'Load Balancing', content: 'Per backend pool, the gateway distributes requests across healthy instances. Algorithms:\n\n  Round-robin — simple, works for homogeneous backends.\n  Least-connections — better when request latency varies (some backends do slower work).\n  Weighted round-robin — for canary deploys with traffic splits.\n  Sticky sessions — for stateful backends; route by client IP or cookie hash to the same instance.\n\nHealth checks: active probes every 5 seconds against /healthz. An instance fails health after 3 consecutive failures and is removed from rotation immediately. Passive health: track per-backend failure rate; circuit-break a backend that exceeds 10% errors for 30 seconds, sending traffic elsewhere.\n\nGRPC and HTTP/2 multiplex many requests over one connection; least-requests works better than least-connections for these protocols.' },
      { section: 'Rate Limiting at the Edge', content: 'Rate limits enforced at the gateway protect both backend services and individual customer quotas. The middleware uses the dedicated rate-limit service (see the Rate Limiter design) for per-key and per-endpoint limits, plus an in-process token bucket per IP for coarse DDoS defence (handles the case where the rate limit Redis itself is overloaded).\n\nReject decisions return 429 with X-RateLimit-* and Retry-After headers so well-behaved clients self-throttle. Rejected requests do not consume backend capacity, which is the entire point — a misbehaving customer cannot exhaust the system for everyone else.' },
      { section: 'Request and Response Transformation', content: 'The gateway acts as an anti-corruption layer between external API contracts and internal service interfaces:\n\n  Inject context headers: X-User-ID, X-Request-ID, X-Correlation-ID derived from the JWT or generated on first contact.\n  Strip sensitive headers from responses before they reach the client (X-Internal-Trace-ID).\n  Translate API versions: a v1 client hitting a v2 backend gets request body field-renaming and response shape transformation. Keeps old clients working while backends evolve.\n  Aggregate: a single client request can fan out to multiple backends and the gateway merges responses (BFF — Backend-for-Frontend pattern).\n\nKeep transformations declarative (OpenAPI extensions, route config) rather than coded — the gateway must stay generic.' },
      { section: 'Retries, Timeouts, and Circuit Breakers', content: 'Per route, the gateway enforces:\n\n  Timeout — kill the upstream call after N seconds; return 504. Distinct per backend; expensive endpoints get longer.\n  Retries — only on idempotent methods (GET, PUT, DELETE) and on retryable errors (5xx, connection failures). Exponential backoff with jitter, capped at 3 attempts.\n  Circuit breaker — if a backend\'s error rate exceeds threshold X over Y seconds, open the breaker and return 503 immediately for all requests to that backend for cooldown period Z. Periodic half-open probes test recovery.\n\nThese protect the gateway itself from being dragged down by a slow backend. Without timeouts, slow backends fill the gateway\'s connection pool and starve healthy traffic. The "thundering herd" failure mode where every request retries simultaneously is mitigated by jitter on backoff.' },
      { section: 'TLS Termination and Certificate Management', content: 'The gateway terminates client TLS so backend services do not need certs. Each gateway holds the cert and the corresponding private key in memory (encrypted at rest, decrypted at boot from a secrets manager).\n\nFor a public API serving many domains (multi-tenant SaaS), use SNI to select certificates per domain. Auto-renew via ACME (Let\'s Encrypt or internal CA) with hot reload — no restart required when certs rotate.\n\nUpstream to backends: either re-encrypt (mTLS between gateway and services, recommended) or plain HTTP over a private network. Re-encrypt is the defensible default in zero-trust environments.' },
      { section: 'Observability', content: 'Every request emits:\n\n  Access log: timestamp, client_ip, method, path, status, latency_ms, backend, request_id, user_id, bytes_in, bytes_out.\n  Metrics (Prometheus): per-route counter (request_total {route, status, backend}), histogram (request_duration_seconds), gauge (active_connections). Per-backend health and circuit-breaker state.\n  Distributed trace: every request gets a trace_id propagated to backends via headers. The gateway is span zero; backends add child spans.\n\nLogs ship to Kafka -> Elasticsearch (or equivalent) for search; metrics ship to Prometheus -> Grafana. Sampling: 100% of error logs, sampled traces for successes (1% is enough at high volume).' },
      { section: 'Failure Modes and Resilience', content: 'The gateway is on the hot path of every request — if it goes down, the system is down. Defences:\n\n  Horizontal scaling: stateless gateway instances behind a network load balancer. N+2 capacity at all times.\n  In-flight protection: graceful shutdown drains current requests before terminating. Health checks return unhealthy during drain so the LB stops sending new traffic.\n  Auth service down: cached JWT public keys keep verification working until cache expiry. After expiry, fail closed (reject) or fail open (allow with no auth context) — depends on the security model.\n  Config service down: gateway keeps last-known good route table in memory. New routes do not appear until the config service recovers.\n  Backend partial outage: circuit breakers isolate the bad backend; healthy backends continue serving. The gateway returns 503 only for routes that have no healthy backend.\n\nThe goal: a gateway should degrade gracefully as dependencies fail, not cascade.' },
      { section: 'Multi-Region Deployment', content: 'For global APIs, run a gateway cluster per region behind a GeoDNS or anycast IP. Each cluster has its own route table replica and a regional Redis for rate limits.\n\nCross-region failover: when the home region of a client fails, DNS or anycast routes them to the next-nearest region. The new region\'s rate-limit state will not match — typically resolved by accepting a brief over-budget window during failover (the alternative is cross-region state sync, which adds latency to every request).\n\nKeep the gateway-to-backend hop in-region whenever possible. A request from a US client hitting an EU gateway because the US is down should also hit EU backends; cross-region backend calls multiply latency.' },
      { section: 'Scaling Levers', content: 'Per axis:\n\n  Throughput: each gateway instance handles ~50K rps on modest hardware (8 cores). Scale horizontally — instances are stateless. Watch CPU; auto-scale at 60% to leave headroom.\n\n  Latency: keep middleware in-process. Every external call (auth service, rate-limit Redis) adds milliseconds. Cache aggressively: JWT keys, route table, API key set, customer config. The hot path should be entirely in-memory.\n\n  Connection pooling: maintain warm connections to each backend pool. New connection establishment (especially HTTPS/mTLS) is expensive; reusing pooled connections cuts P99 latency dramatically.\n\n  Config size: a gateway with 1000 routes loads its route table in <100ms. At 100K routes, route table memory and lookup latency start to matter; partition routes across gateway clusters by host.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Web[Web App]
        Mobile[Mobile App]
        Partner[Partner Service]
    end
    subgraph Edge
        TLS[SSL TLS Termination]
        LB[Global Load Balancer]
    end
    subgraph Gateway [Gateway Pipeline]
        GW[API Gateway Cluster]
        AuthMW[JWT and API Key Auth]
        RLMW[Rate Limiter Middleware]
        Router[Service Router]
        LBMW[Per-Service Load Balancer]
        TransformMW[Req and Resp Transformer]
    end
    subgraph Services
        AuthSvc[Auth Service]
        SvcA[Service A]
        SvcB[Service B]
        SvcC[Service C]
        Health[Health Check Service]
    end
    subgraph Async
        LogShipper[Log Shipper]
        MetricsAgg[Metrics Aggregator]
    end
    subgraph Storage
        Registry[(Service Registry Consul)]
        RLRedis[(Rate Limit Redis)]
        KeyCache[(JWT Public Key Cache)]
        ConfigDB[(Routing Config)]
    end
    subgraph Analytics
        Kafka[Kafka Access Logs]
        ELK[(Elasticsearch ELK)]
        Prom[(Prometheus Metrics)]
        Grafana[Grafana Dashboards]
    end

    Web --> TLS --> LB --> GW
    Mobile --> TLS
    Partner --> TLS

    GW --> AuthMW
    AuthMW --> AuthSvc
    AuthMW --> KeyCache
    GW --> RLMW --> RLRedis
    GW --> Router
    Router --> Registry
    Router --> ConfigDB
    Router --> LBMW
    LBMW --> SvcA
    LBMW --> SvcB
    LBMW --> SvcC
    Health -->|active probe| SvcA
    Health -->|active probe| SvcB
    Health -->|active probe| SvcC
    Health --> Registry

    GW --> TransformMW
    SvcA --> TransformMW
    SvcB --> TransformMW
    SvcC --> TransformMW
    TransformMW --> Web

    GW -->|access logs| Kafka --> LogShipper --> ELK
    GW -->|metrics scrape| Prom --> Grafana
    GW --> MetricsAgg --> Prom

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class Registry,RLRedis,KeyCache,ConfigDB storage
    class LogShipper,MetricsAgg async
    class TLS,LB edge
    class Kafka,ELK,Prom,Grafana analytics`,
    tradeoffs: [
      { decision: 'Gateway validates JWT in-process vs dedicated auth sidecar', rationale: 'In-gateway validation is faster (no network hop, sub-millisecond) and lets the gateway carry user context directly into other middlewares. A dedicated auth sidecar (per-request call to an auth service) separates concerns more cleanly and centralises auth logic but adds 1-3ms per request and a hard dependency. Use in-process validation for high-throughput APIs; use a sidecar when auth logic is complex (token introspection, dynamic policy evaluation) and you cannot afford to redeploy the gateway when policy changes.' },
      { decision: 'One global gateway cluster vs gateway per region', rationale: 'A global cluster (anycast IP, single config) is simpler operationally — one set of routes, one rate-limit Redis. Per-region clusters give lower client latency (no cross-region hop for nearby clients) and contain regional failures. The cost is replicating config across regions and accepting that rate-limit state is per-region (not globally exact). For any latency-sensitive global API, per-region is the right answer.' },
      { decision: 'BFF (Backend-for-Frontend) vs single generic gateway', rationale: 'A generic gateway exposes backend services as-is — every client (mobile, web, partner) hits the same API. A BFF gateway aggregates and transforms responses per client class — the mobile BFF returns a smaller, mobile-optimised payload from the same backends. BFF reduces over-fetching and chattiness but adds a tier to maintain. Worth it when client classes have meaningfully different needs; over-engineering for a single client.' },
      { decision: 'Service discovery via DNS vs sidecar (service mesh)', rationale: 'DNS-based discovery is universal — every gateway resolves backend hostnames to current pod IPs. Slow propagation on changes (DNS TTL) and limited to one backend per name. A service mesh sidecar (Envoy, Linkerd) gives finer control: per-request routing, mTLS without app changes, richer health signal. Use DNS for simple cases; adopt a mesh when you need traffic shaping, mTLS by default, or rich observability per request.' },
      { decision: 'Gateway-level retries vs client-only retries', rationale: 'Gateway retries on idempotent failures save the client from having to implement backoff and absorb transient backend hiccups invisibly. The danger is retry storms — a backend that is briefly slow gets pummelled by retries, making the outage worse. Mitigate with strict caps (3 attempts), jitter, circuit breakers, and idempotency guarantees on the backend. Without those, gateway retries cause more outages than they prevent.' },
    ],
    keyTakeaways: [
      'A gateway centralises cross-cutting concerns so backend services do not reimplement auth, rate limiting, and observability separately',
      'JWT verification with cached public keys keeps auth checks at sub-millisecond cost — never call the auth service per request',
      'Service registry watch notifications let the gateway pick up new backend instances and config changes without restart',
      'Timeouts, retries, and circuit breakers on the outbound side are what stop a slow backend from dragging the gateway down with it',
      'The gateway is on the hot path of every request — design it to fail gracefully when each downstream (auth, config, Redis, backends) goes wrong, never cascade',
      'Per-region clusters beat a global cluster for any latency-sensitive API; rate-limit state being per-region is a fair trade for the latency win',
    ],
    faqs: [
      { question: 'Why not just put auth, rate-limit, and routing in each microservice instead of a separate gateway?', answer: 'Three reasons. First, duplication — every service team rewrites the same auth and rate-limit code, with inevitable inconsistencies. Second, security — exposing each backend directly enlarges the attack surface and forces each team to harden their TLS endpoint. Third, evolution — when you change auth (rotate keys, switch from session to JWT), you change it in one place, not across N services. The gateway is the natural seam between "what the world hits" and "what your services do." That said, business-logic checks (this user can place 3 orders per day) belong in the relevant service, not the gateway.' },
      { question: 'How does the gateway pick up new backend instances when you autoscale?', answer: 'A watch loop on the service registry (Consul, etcd, Kubernetes API). New pods register on startup; deregister on shutdown; the registry broadcasts deltas. The gateway maintains an in-memory pool per backend service and updates it on every registry event. Health checks (active /healthz probes every few seconds) filter unhealthy instances before they receive traffic. Adding a new instance: registration, health-check-passes, ~5 seconds before it gets traffic — fast enough that autoscaling tracks load shifts. Removing one: deregister, drain in-flight, terminate.' },
      { question: 'What happens to a long-running request when the gateway is shut down?', answer: 'Graceful shutdown: the gateway flips its readiness probe to unhealthy so the front-end load balancer stops sending new requests, then waits for in-flight requests to drain (with a hard cap, typically 30-60 seconds). In-flight requests complete normally and get their responses to the client. After the drain cap, remaining requests get a 503 and the process exits. Without graceful shutdown, every restart drops thousands of in-flight requests — visible to users as random failures. With it, restarts are invisible.' },
      { question: 'How do you handle WebSockets and long-polling through a gateway?', answer: 'WebSockets are stateful, long-lived connections — they break the assumption that the gateway is request-response. Two options. First, dedicated gateway tier for WebSockets that forwards via a TCP-level proxy after the initial HTTP upgrade — the gateway holds two connections (client and backend) for the lifetime of the session. Second, route WebSockets to a separate WebSocket gateway optimised for many concurrent idle connections (Envoy in TCP-proxy mode, or a custom Go service). HTTP gateways and WebSocket gateways have very different memory profiles (HTTP wants throughput, WS wants connection density); separating them is usually right past ~10K WebSockets per node.' },
      { question: 'Should the gateway terminate TLS or pass it through to backends?', answer: 'Almost always terminate. Termination lets the gateway inspect the request for routing, rate limiting, and auth — pass-through means the gateway is a dumb L4 proxy and most of its value disappears. The compromise some security-sensitive systems use is re-encrypt: gateway terminates client TLS, validates the request, then opens a fresh mTLS connection to the backend. This gives you both inspection at the gateway and confidentiality on the internal hop. Pure pass-through is reserved for cases where the gateway must not see the payload (compliance reasons) and even then it is usually wrong — the gateway can see the payload but be required not to log it.' },
      { question: 'Why are gateway retries dangerous and what mitigates them?', answer: 'A retry storm: a backend slowdown causes every gateway to retry. The backend, already overloaded, now gets 2-3x the load. It slows further. More retries. The outage cascades. Mitigations are layered. First, only retry idempotent methods on retryable errors (5xx, connection timeouts). Second, exponential backoff with random jitter — retries do not arrive synchronised. Third, low retry caps (3 attempts max). Fourth, circuit breakers: when error rate hits threshold, stop sending traffic at all for a cooldown. Fifth, per-backend retry budgets that prevent retries from exceeding (say) 10% of normal traffic. Without these, retries make incidents worse.' },
      { question: 'Should rate-limit Redis be local to each gateway region or global?', answer: 'Local. Global would mean every rate-limit check makes a cross-region round-trip, adding tens of milliseconds — which makes the gateway slower than serving the backend directly. Per-region Redis means a customer routed to two regions during failover briefly gets 2x their global limit, which is acceptable for almost every use case. If you genuinely need a global limit (e.g., billing-critical monthly quota), enforce it asynchronously: each region tracks usage locally, reports up to a central aggregator every few seconds, and the central aggregator flips a global kill-switch if total usage approaches the quota. This is exact-enough for billing without putting cross-region calls on the hot path.' },
      { question: 'How do you do canary deployments through the gateway?', answer: 'Two layers. At the routing layer, configure a weighted split: 95% of requests for /api/foo go to the stable pool, 5% to the canary pool. The split is in config and changes immediately on push. At the observability layer, tag every gateway log and metric with the deployment color (stable/canary) so you can compare error rates, latency, and business metrics between them in real time. If the canary degrades, push a config update to revert the split to 100% stable — within seconds. Sticky canaries (the same user always sees the canary) are an option for stateful workflows but add session-tracking complexity.' },
      { question: 'When should you use a service mesh instead of an API gateway?', answer: 'They are complementary, not alternatives. The gateway sits at the edge between clients and the system; the mesh sits between services inside the system. The gateway handles client-facing concerns: external auth, public rate limits, request shaping. The mesh handles service-to-service concerns: mTLS by default, retries between services, distributed tracing, traffic shifting. Most production systems eventually run both: gateway at the perimeter, mesh sidecars on every service pod. Some teams collapse them when traffic is small (use only a gateway, services talk plain HTTP internally) — fine as a starting point, but you outgrow it once internal service count climbs.' },
      { question: 'How big can the route table grow before lookup becomes a bottleneck?', answer: 'A radix tree (or trie) over paths can comfortably hold tens of thousands of routes with sub-microsecond lookup. The bottleneck appears when you have hundreds of thousands of routes (e.g., per-tenant routes in a SaaS), where memory and config-reload latency start to matter. Two patterns: shard the gateway by host (route gateway-A handles tenant-a.example.com, gateway-B handles tenant-b.example.com) so each instance has fewer routes; or precompile the route table into a perfect-hash function at deploy time. For the typical case of dozens to hundreds of routes, lookup is free and you should not worry.' },
    ],
  },
  {
    id: 6,
    slug: 'design-youtube',
    title: 'Design YouTube / Video Streaming',
    difficulty: 'Hard',
    category: 'Content Delivery',
    tags: ['video', 'cdn', 'streaming', 'encoding', 'storage'],
    problemStatement: `Design a video streaming platform like YouTube. Users should be able to upload videos, which are then transcoded and served globally. Target: 2B users, 500 hours of video uploaded per minute, billions of views per day.`,
    requirements: {
      functional: ['Upload videos up to 10GB', 'Transcode to multiple resolutions (360p–4K)', 'Stream video with adaptive bitrate', 'Search videos, comments, likes', 'Recommendations'],
      nonFunctional: ['Upload < 5min for 1GB video', 'Playback start < 2s', 'Global availability via CDN', 'Petabyte-scale storage'],
    },
    capacityEstimates: `500 hrs/min uploaded → ~30,000 sec of raw video/sec\nEncoded storage: 1 hr video at 4 resolutions ≈ 10GB\n500 hrs × 10GB = 5TB/min new storage\nViews: billions/day → ~500K concurrent streams`,
    solutionBreakdown: [
      { section: 'API Design', content: 'Endpoints separated by upload (slow, large) and watch (fast, frequent):\n  POST /upload/initiate { title, content_type, size }  -> { upload_id, resumable_url }\n  PUT  {resumable_url}  (chunked, resumable upload directly to edge)\n  POST /videos { upload_id, title, description, tags, visibility }  -> { video_id }\n  GET  /videos/{id}  -> metadata, playback manifest URL\n  GET  /videos/{id}/manifest.m3u8 (or .mpd)  -> the adaptive manifest\n  GET  /cdn/{video_id}/{quality}/segment_{n}.ts  -> media bytes (served by CDN, not origin)\n  GET  /search?q=  -> { results[] }\n  POST /videos/{id}/like, /videos/{id}/comments, etc.\n\nThe upload endpoint returns a resumable URL pointing at an edge upload server near the client. Watch traffic is split: metadata from origin APIs, media bytes from CDN.' },
      { section: 'Resumable Upload Pipeline', content: 'A 10GB upload over a flaky mobile connection cannot be one PUT. Use a resumable protocol (tus, or Google\'s Resumable Upload Protocol):\n  Client requests initiate. Edge server allocates an upload_id and an S3 multipart-upload UploadId.\n  Client PUTs chunks (typically 8MB) to the edge with Content-Range headers. Edge proxies each chunk into the multipart-upload.\n  On a network drop, client queries the upload_id to see which chunks landed; resumes from the first missing chunk.\n  When all chunks are in, edge calls CompleteMultipartUpload. The raw video object materialises in S3.\n  S3 PutObject event fires through SQS to start transcoding.\n\nThe edge upload server exists so client uploads use the nearest PoP rather than the far origin region — RTT for 8MB chunks matters. The edge does not transcode; it only assembles.' },
      { section: 'Transcoding Pipeline', content: 'Once the raw upload lands, generate the playable variants. Two-stage:\n\n  Stage 1 (segmentation): split the source into 2-6 second segments. Each segment is independently transcodable. Use ffmpeg with -hls_time 4 -hls_segment_type fmp4 for fragmented MP4 (works for both HLS and DASH).\n\n  Stage 2 (transcoding): fan out segments to a worker fleet (Kubernetes jobs, or a dedicated GPU pool for HEVC/AV1). Each worker transcodes one segment into all target bitrates: typically a ladder of 144p / 240p / 360p / 480p / 720p / 1080p / 1440p / 2160p with bitrate ramping (e.g., 1080p at 5 Mbps, 720p at 2.5 Mbps). Output goes to S3 under prefix encoded/{video_id}/{quality}/.\n\nA manifest writer assembles the master m3u8 (HLS) or mpd (DASH) and writes it to S3 once the highest-priority quality (usually 720p) finishes — viewers can start watching before the full ladder is done. Long videos finish lower-priority qualities in the background.' },
      { section: 'Adaptive Bitrate Streaming (HLS / DASH)', content: 'The player downloads the master manifest, picks an initial bitrate (based on connection-type signal or last session), and starts pulling segments. After each segment, it measures throughput and buffer fullness and adapts:\n\n  Throughput-based ABR: pick the highest bitrate the measured throughput supports.\n  Buffer-based ABR (BOLA): pick the bitrate that keeps the buffer healthy.\n  Hybrid: most production players combine both.\n\nSegments are typically 2-6 seconds. Shorter = faster adaptation but more manifest overhead and worse compression efficiency. Longer = better compression but slow to react to bandwidth changes. 4 seconds is the sweet spot for most use cases; 2 seconds for low-latency live streaming.\n\nWhy HLS and DASH? HLS works natively on iOS/Safari (mandatory there) and most TVs. DASH gives finer control on Android and web. Most platforms ship both; manifest writers produce both from the same encoded segments.' },
      { section: 'CDN Distribution', content: 'CDN absorbs the playback bandwidth. The origin is S3; CDN PoPs cache segments. Cache key is the segment URL (which includes video_id, quality, segment number). Hot videos (a viral upload) get cached at every PoP after the first viewer in each region; long-tail videos cache only where viewed.\n\nCDN cost is the single largest line item at YouTube scale. Levers: longer cache TTL (segments are immutable so TTL can be effectively infinite — set Cache-Control: public, max-age=31536000), aggressive pre-warming for trending uploads (push to PoPs proactively when view rate exceeds threshold), and tiered cache hierarchy (PoP -> regional -> origin) so a cold PoP hits the regional cache before going back to origin.\n\nManifest files have shorter TTL (seconds) because they reference segment URLs that the platform may rotate for token rotation or DRM.' },
      { section: 'Video Metadata Store', content: 'Cassandra, partitioned by video_id:\n  videos(video_id PK, channel_id, title, description, duration_sec, upload_status, visibility, encoded_qualities list, thumbnail_url, like_count_cached, view_count_cached, created_at)\n  channel_videos(channel_id PK, video_id CK desc) for "list videos in channel" queries.\n\nMetadata queries are 1:1 by video_id (when fetching the watch page) or scan-by-channel (channel pages). Cassandra handles both cleanly. Search lives in Elasticsearch, populated via CDC from Cassandra; ES handles "find videos matching foo" while Cassandra handles "get the metadata for video X."' },
      { section: 'View Counts and Engagement', content: 'View counting is more nuanced than incrementing a counter. A view "counts" if the user watched ~30 seconds (defined by product). Mechanism:\n  Client sends periodic heartbeats during playback (every 10 seconds) with (video_id, user_id, position_sec).\n  Heartbeats land in Kafka.\n  A consumer aggregates per-(video_id, user_id) and emits a "qualified view" event when the 30s threshold is hit, deduped per user per video per day to prevent counter inflation from refreshing the page.\n  Qualified views increment a Redis counter, flushed to Cassandra view_count_cached every 30s.\n\nThe client also shows an "anti-cheat" interstitial after suspicious patterns (rapid view-rate from one device) to prevent botting. The published view count is the deduped value, not raw heartbeat count.' },
      { section: 'Recommendations and Home Feed', content: 'YouTube\'s home is algorithmic. Architecture:\n  Candidate retrieval: per-user candidate generators score billions of videos down to a few thousand (collaborative filtering, watch-history embeddings, channel subscriptions). Runs offline (Spark) every few hours; per-user candidate list cached in a feature store.\n  Online ranker: at request time, fetch the candidate list, score each candidate with a deep-learning model using ~hundreds of features (recent watch history, time of day, device, freshness), and return the top-N. Latency budget: ~100ms.\n  Diversity: a post-rank step injects diversity (genre mix, channel mix) to prevent the feed from collapsing to a single creator.\n\nFeature store: Redis for hot per-user features, an offline columnar store (BigQuery, ClickHouse) for batch features. The online ranker is a TensorFlow or PyTorch model served on a CPU/GPU inference fleet.' },
      { section: 'Search', content: 'Elasticsearch over (title, description, tags, transcript). Transcripts come from an automated speech-recognition pipeline (run on the audio track during transcoding). Search ranking combines BM25 relevance with engagement signals (watch time on this video for similar queries, channel authority).\n\nSearch is a separate read path from watch — the index is refreshed via CDC from Cassandra (Debezium tailing the commit log). New videos appear in search within ~30 seconds of upload completion.' },
      { section: 'Comments, Likes, and Subscriptions', content: 'Comments in their own Cassandra table partitioned by video_id, clustered by comment_id descending. Long videos (1M+ comments) page on comment_id cursor. Replies nest one level — replies(parent_comment_id PK, reply_id CK).\n\nLike/dislike: per-video Redis counter (HINCRBY), flushed to Cassandra. Per-user "have I liked this?" lookup via a tiny sharded relational store keyed by (user_id, video_id).\n\nSubscriptions: subscriptions(subscriber_id, channel_id). On a new upload, fan-out worker pushes the video_id to each subscriber\'s upload-notification queue (similar pattern to Twitter timeline fan-out, with celebrity-tier threshold for huge channels).' },
      { section: 'Live Streaming Path', content: 'Live is a different pipeline from VOD. Ingest: RTMP or SRT from the creator\'s encoder lands at an edge ingest server. The ingest transcodes in real time to multiple bitrates, segments into 2-4 second chunks, and writes them to S3 with a rolling window (e.g., last 4 hours kept on origin storage).\n\nThe manifest updates every segment, pointing at the latest N segments. Viewers download new segments as they appear; total end-to-end latency is typically 5-30 seconds (faster modes like LL-HLS or LL-DASH push under 5 seconds at the cost of CDN cache efficiency).\n\nLive consumes much more origin bandwidth than VOD (no long-tail cache reuse). Plan capacity for peak concurrent viewers.' },
      { section: 'Failure Modes and Recovery', content: 'Upload chunk lost mid-flight: client resumes from last acknowledged chunk via the resumable protocol. No bytes re-transferred unnecessarily.\n\nTranscoding worker crash: SQS visibility timeout returns the segment job to the queue; another worker picks it up. Idempotent — output is the same regardless of which worker transcodes a given segment.\n\nCDN origin overload: tiered cache (regional caches between PoP and origin) absorbs the burst. If origin is truly down, viewers serving from CDN cache continue without issue; only cold videos break.\n\nViral video, cold CDN: the first viewer in a PoP triggers cache fill. To prevent thundering herd against origin when many PoPs all cold-miss at once, use cache-fill coalescing (only one cold-miss request goes to origin per PoP per segment).\n\nMetadata Cassandra node down: replication factor 3, LOCAL_QUORUM reads tolerate one node loss with no impact.' },
      { section: 'Observability', content: 'Key SLIs split by surface:\n  Upload: upload_completion_rate (alert < 95%), resumable_chunk_retry_rate.\n  Transcoding: transcoding_job_queue_depth (alert > 1h backlog), transcoding_p99_latency, encoded_quality_completion_rate per video.\n  Playback: time_to_first_frame (alert > 2s), buffering_ratio (alert > 1% per region), bitrate_distribution per region, CDN_cache_hit_ratio per region (alert < 90%).\n  Engagement: views_per_second, comments_per_second, subscription_fanout_lag.\n\nStructured logs flow through Kafka -> Elasticsearch for search; metrics via Prometheus -> Grafana. Per-region dashboards for CDN performance — degradation in one region (typically a peering issue) needs to be visible before users complain.' },
      { section: 'Scaling Levers', content: 'Bytes-out dominates cost. Levers in order of impact:\n\n  Encoder efficiency: AV1 over H.264 saves ~50% bandwidth for the same quality. Trade-off: slower encode and limited client support. Encode AV1 for popular videos only (decide after view counts cross a threshold) and H.264 universally.\n\n  Per-title encoding: encode each video with bitrate tuned to its complexity (a slow-pan landscape needs much less bitrate than a high-motion sports clip). Saves 20-30% bandwidth across the catalog vs uniform ladders.\n\n  Pre-positioning for trending content: when view rate crosses a threshold, proactively push segments to every CDN PoP rather than waiting for first-view fills. Cuts cold-miss latency to zero.\n\n  Long TTLs on immutable segments: setting max-age=1y on segment files maximises CDN cache utilisation. Manifests have short TTL (seconds) so token-bound URLs can rotate.\n\n  ISP appliances: for very-high-traffic content, install Netflix-style ISP appliances inside ISPs (YouTube does this for popular regions). Saves transit cost entirely.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Web[Web Player]
        Mobile[Mobile App]
        TV[TV / Console]
    end
    subgraph Edge
        GeoDNS[Geo-DNS]
        CDN[CDN Edge PoPs]
        EdgeUp[Edge Upload Servers]
    end
    subgraph Gateway
        APIGW[API Gateway]
        Auth[Auth and OAuth]
    end
    subgraph Services
        Upload[Upload Service]
        Playback[Playback Service]
        Meta[Video Metadata Service]
        Search[Search Service]
        Recs[Recommendation Service]
        Comments[Comments Service]
        Subs[Channels and Subscriptions]
        Notif[Notification Service]
        Views[View Counter]
        Ads[Ads and Monetization]
        Mod[Content Moderation]
    end
    subgraph Async [Async Pipelines]
        TQ[Transcoding Queue]
        Workers[Transcoder Workers]
        Thumbs[Thumbnail Generator]
        CID[Content ID Scanner]
        Trainer[Rec Model Training]
    end
    subgraph Storage
        Raw[(Raw Video S3)]
        Enc[(Encoded Segments and HLS Manifests)]
        MetaDB[(Video Metadata Cassandra)]
        ES[(Elasticsearch)]
        Counter[(Redis View Counter)]
        CommentDB[(Comments DB)]
        UserDB[(User and Subs DB)]
    end
    subgraph Analytics
        EventBus[Kafka Event Bus]
        Lake[(Data Lake S3)]
        Feature[Feature Store]
    end

    Web -->|request presigned URL| APIGW
    APIGW --> Auth
    APIGW --> Upload
    Upload -->|presigned PUT| Web
    Web -->|chunked upload| EdgeUp --> Raw
    Raw -->|object event| TQ --> Workers
    Workers --> Enc
    Workers --> Thumbs --> Enc
    Workers --> CID --> Mod
    Workers --> Meta
    Meta --> MetaDB
    Meta --> ES

    Mobile -->|DNS lookup| GeoDNS
    Mobile -->|watch page| APIGW
    APIGW --> Playback
    Playback --> Meta
    Playback --> Counter
    Playback --> Ads
    Mobile -->|manifest and segments| CDN
    CDN -->|origin miss| Enc
    Mobile -->|view event| EventBus

    TV -->|query| APIGW --> Search --> ES
    Mobile -->|home feed| Recs
    Recs --> Feature
    EventBus --> Lake --> Trainer --> Feature

    Web -->|comment and like| APIGW
    APIGW --> Comments --> CommentDB
    APIGW --> Subs --> UserDB
    Subs --> Notif --> Mobile

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class Raw,Enc,MetaDB,ES,Counter,CommentDB,UserDB storage
    class TQ,Workers,Thumbs,CID,Trainer async
    class GeoDNS,CDN,EdgeUp edge
    class EventBus,Lake,Feature analytics`,
    tradeoffs: [
      { decision: 'Pre-transcode every quality vs on-the-fly transcoding', rationale: 'Pre-transcoding all qualities (typically 8-10 bitrates × 3 codecs) costs storage but lets the CDN serve immediately with zero compute. On-the-fly transcoding saves ~80% of storage cost but adds CPU/GPU cost on every cache miss and increases first-segment latency. For platforms with deep long-tail catalogs (millions of videos viewed once a month), JIT transcoding for the long tail and pre-encoding for popular content is the cost-optimal hybrid.' },
      { decision: 'HLS vs MPEG-DASH vs both', rationale: 'HLS works natively on iOS/Safari and most TVs and is required there. DASH is more flexible and standard on web/Android. Shipping only HLS works (every device can play it) but limits some advanced features (DASH has better DRM, better live latency modes). Shipping only DASH leaves iOS broken. Most large platforms ship both, generating both manifests from the same fMP4 segments — the storage cost is just two manifest files per video, segments are shared.' },
      { decision: 'Edge upload server vs direct S3 multipart from client', rationale: 'Direct multipart-to-S3 from the client (with a presigned URL) skips the edge upload tier and saves a hop. Works fine for short-haul uploads but suffers on global / poor connections — the client has to talk to one of the few S3 regions, with RTT in the hundreds of ms. An edge upload tier near the client buffers chunks at low RTT, then transfers to origin S3 over a fat pipe. Worth the edge cost once you have international users; skip it for a single-region product.' },
      { decision: 'Cassandra vs PostgreSQL for video metadata', rationale: 'Cassandra handles the write rate (uploads + heartbeats + engagement events translated into video updates) and partitions cleanly by video_id. Postgres would need explicit sharding past a single primary. For YouTube-scale, Cassandra is the obvious pick. For a smaller platform (~1M videos), Postgres is simpler and gives you secondary indexes and joins.' },
      { decision: 'Strict view count vs eventually-consistent view count', rationale: 'Strict count would serialise on the video row and make viral videos write-bound. Eventually-consistent counts (Redis with periodic flush) handle any view rate without contention but the display lags by seconds. UX shows the eventually-consistent count; product is fine with it because the counter changes too fast for users to notice the lag. Strict counts are reserved for billing-relevant metrics (e.g., ad impressions counted for billing) where exactness matters.' },
    ],
    keyTakeaways: [
      'Resumable upload protocols are mandatory for multi-GB uploads on mobile; one-shot PUTs fail in production',
      'Segment-and-fan-out transcoding scales linearly with worker count and recovers cleanly from any individual worker crash',
      'Adaptive bitrate (HLS/DASH) is what makes streaming work on real networks — pick segment size around 4 seconds for the right adaptation-vs-compression trade',
      'CDN cache hit ratio is the single biggest cost line; long TTLs on immutable segments plus pre-warming for trending content move the needle most',
      'View counts must run as an async pipeline through Kafka with per-user dedup; synchronous counter updates on viral videos are impossible',
      'Recommendations run as a two-stage candidate-then-rank pipeline; never score the full catalog per request',
      'Live streaming is a separate pipeline from VOD — the origin bandwidth and segment-rotation patterns are completely different',
    ],
    faqs: [
      { question: 'Why segment-based transcoding instead of transcoding the whole video?', answer: 'A 1-hour video transcoded on one machine takes ~30 minutes; split into 600 segments of 6 seconds each, the work parallelises across 600 workers and finishes in seconds. Segment-level parallelism is the only way to keep transcoding time approximately constant as video length grows. It also makes failure isolation cheap: a worker crash loses one segment, not the whole video. The trade-off is that segment boundaries must be on GOP (keyframe) boundaries — the segmenter picks split points that align with the source codec\'s keyframes to avoid having to re-encode neighbouring segments.' },
      { question: 'How does the player actually pick the right bitrate?', answer: 'It runs an ABR algorithm. The simplest is throughput-based: measure how long the last segment took to download, divide by segment duration, and you have your current throughput. Pick the highest bitrate variant whose required throughput is below 80% of measured (with safety margin). Buffer-based (BOLA) ignores throughput and looks at how full the buffer is — high buffer = take a higher quality, low buffer = drop. Production players blend both: throughput dominates the steady state, buffer-based dominates near startup or when bandwidth shifts suddenly. The algorithm also smooths to avoid quality flickering — never drop down for a single bad segment.' },
      { question: 'Why segment size of 4 seconds and not 1 second or 30 seconds?', answer: 'Trade-offs. Short segments (1-2s) react fast to bandwidth changes and reduce live-streaming latency, but compression efficiency drops because each segment needs its own keyframe and overhead. Long segments (10-30s) compress better but the player cannot adapt mid-segment, so a sudden bandwidth drop causes a stall. Four seconds is the production sweet spot: enough compression efficiency, fast enough adaptation. Live streaming pushes to 2 seconds; ultra-low-latency live (LL-HLS) uses sub-second chunks within segments. VOD with high motion benefits from 6-second segments because the encoder gets more context for compression.' },
      { question: 'How do you stop view-count gaming via bots and refresh-spamming?', answer: 'Multi-layer. First, dedup at the view-event level: a "qualified view" is one (user, video, day) tuple, no matter how many times the user re-loads. Second, require playback heartbeats — a view only counts after ~30 seconds of actual playback signal, which a refresh-bot would have to actually consume bandwidth to fake. Third, anti-bot signals at the heartbeat layer: detect impossibly fast view rates, suspicious user-agents, missing browser fingerprints, and discount or drop those views. Fourth, hand-curate algorithmic filters for known botnets. The published view count is whatever survives all of these — typically 10-20% less than raw heartbeat events.' },
      { question: 'What happens when a brand-new video goes viral before CDN warm-up?', answer: 'The first viewer in each PoP triggers a cold-miss to origin. If 100 PoPs all cold-miss simultaneously, you get a thundering herd of 100 origin reads per segment. Mitigations: tiered cache (PoP -> regional cache -> origin) means most cold misses hit a regional cache that already has the segment. Cache-fill coalescing at each PoP: when many requests arrive for an uncached segment, only one request proceeds to origin while the others wait for the response — collapses N concurrent misses into 1. Proactive pre-warming: monitor view rate and once a video crosses a threshold, push it to all PoPs in advance of viewer demand. Combined, viral videos do not flatten the origin.' },
      { question: 'Why are recommendations done in two stages instead of just scoring everything?', answer: 'Scoring 10 billion candidate videos against a complex ML model per request would take hours and cost a fortune. Two-stage cuts the work massively. Candidate retrieval uses cheap, parallelisable methods (collaborative filtering, embedding nearest neighbours, channel subscription matches) to narrow 10 billion to ~10,000 in batch overnight. The online ranker runs the expensive model on only those 10,000 per request, finishing in 100ms. Diversity is added post-rank. The same architecture (retrieval, ranking, diversity) shows up in every large-scale recommendation system — YouTube, Netflix, Instagram all use variations of it.' },
      { question: 'How are private/unlisted videos handled given CDN caching?', answer: 'CDN URLs are signed: the watch page generates a URL with a short-lived (typically 1-4 hour) cryptographic signature derived from (video_id, user_id, expiry). The CDN validates the signature on every request. An unauthorised user accessing a copied URL gets a 403 because the signature is bound to their session. Cache key includes the signed segment URL excluding the signature, so different users with valid signatures for the same private video share the cache entry. Manifest URLs rotate by signature TTL — the player re-fetches the manifest when it expires, getting fresh signed segment URLs.' },
      { question: 'How do live streams keep the latency under 10 seconds?', answer: 'Standard HLS has ~30 seconds end-to-end latency because the segment must be fully encoded before viewers can request it, then they need 2-3 segments buffered. Low-latency HLS (LL-HLS) and CMAF chunked encoding allow the viewer to start downloading a segment before it is fully encoded — the encoder writes chunks (e.g., 200ms each) and the player downloads them incrementally. This drops end-to-end to 3-5 seconds. The trade-off is more origin connections (chunks are smaller and more frequent) and worse CDN cache efficiency because chunk boundaries do not align with cache TTLs. For platforms where latency matters (gaming, sports), the latency win is worth the cost.' },
      { question: 'Why use Cassandra over a relational store for metadata?', answer: 'Three reasons. First, writes — 100M uploads/day plus billions of heartbeat-driven metadata updates is far above what a single Postgres can sustain without explicit sharding. Cassandra scales linearly with nodes. Second, partition pattern — watch-page metadata reads are 1:1 by video_id, channel-page reads are slices of a channel partition; both map cleanly to Cassandra. Third, replication for global reach — Cassandra\'s built-in multi-DC replication beats Postgres logical replication for global setups. The downside (no real joins, weak secondary indexes) is mitigated by denormalising aggressively and using Elasticsearch for search.' },
      { question: 'How would the design change for a TikTok-style short-video platform?', answer: 'Most of the architecture survives, with a few shifts. Short videos (30-90 seconds) are small — full-quality encodes can be pre-positioned cheaply, so the long-tail-encoding question changes. The feed is much more aggressive about discovery (interest-based vs subscription-based), so the recommendation pipeline gets larger candidate pools and the diversity / freshness penalty matters more. Engagement events are denser per-second (a user views many videos in a session), so the heartbeat pipeline needs more partition headroom. Live streaming becomes less important; ephemeral content (stories-style) becomes more important and needs the same TTL-bounded storage trick as Instagram stories. The core upload-transcode-CDN-metadata flow is essentially identical.' },
    ],
  },
  {
    id: 7,
    slug: 'design-cdn',
    title: 'Design a CDN',
    difficulty: 'Hard',
    category: 'Content Delivery',
    tags: ['cdn', 'caching', 'dns', 'edge', 'geo-routing'],
    problemStatement: `Design a Content Delivery Network (CDN) that serves static assets (images, JS, CSS, video) from servers geographically close to users. Reduce origin server load and improve global latency.`,
    requirements: {
      functional: ['Cache and serve static content from edge nodes', 'Invalidate or purge cached content on demand', 'Route users to the nearest edge', 'Support HTTPS/TLS at the edge'],
      nonFunctional: ['< 20ms latency for cache hits globally', '99.999% availability', 'Handle terabits/sec aggregate throughput', 'Survive edge node failures'],
    },
    capacityEstimates: `100 edge PoPs globally\nEach PoP: 10TB SSD cache, 100Gbps bandwidth\nGlobal: 1 Pbps aggregate capacity\nCache hit ratio target: > 90%`,
    solutionBreakdown: [
      { section: 'What a CDN Actually Does', content: 'A CDN solves three problems at once. First, latency — by placing servers near users, the speed-of-light round-trip drops from 150ms (across an ocean) to <20ms (within a metro area). Second, origin load — by absorbing repeat requests at the edge, the CDN means most reads never reach the origin. Third, throughput — by spreading traffic across hundreds of PoPs (Points of Presence), the CDN delivers terabits per second without the origin having terabit pipes.\n\nThe CDN is conceptually simple: a fleet of caching reverse-proxies with smart request routing. The interesting engineering is in the routing (how clients find the right edge), the cache hierarchy (how edges find each other and the origin), invalidation, and TLS.' },
      { section: 'Client Routing: DNS-Based vs Anycast', content: 'How does the client get to the nearest PoP?\n\n  DNS-based routing: client resolves cdn.example.com via the CDN\'s authoritative DNS. The DNS resolver looks at the client IP (or its resolver IP) and returns the A/AAAA record for the closest PoP. Pros: fine-grained control (route per ASN, per ISP); easy to A/B test. Cons: client may be far from its DNS resolver (e.g., using 8.8.8.8 from Asia), so the resolver IP misleads. EDNS Client Subnet (ECS) partially mitigates by passing client IP into the DNS query.\n\n  Anycast: many PoPs share the same IP. BGP routes each client to the topologically closest PoP. Pros: no extra DNS round-trip, instant failover when a PoP goes down (BGP withdraws and traffic re-routes). Cons: harder to do precise geo-routing (you get topological closest, not geographic closest); requires controlling network announcements at every PoP.\n\nLarge providers use both: anycast for IPs that need fast failover (DNS itself, control plane), DNS-based for content traffic where geo-precision matters.' },
      { section: 'Cache Hierarchy', content: 'A single tier of edge PoPs would mean every cold miss goes to origin — a problem because edges have small SSDs and a single hot piece of content might be requested in 100 PoPs simultaneously. Tiered cache:\n\n  L1 (Edge PoP, ~10TB SSD): handles the client request. Hit ratio target: ~90% for popular content.\n  L2 (Regional Mid-tier, ~100TB HDD): groups of edges share a regional cache. An L1 miss goes to the regional first, not origin. Hit ratio: ~95% for warm content.\n  L3 (Origin Shield, optional): a single PoP per region that all regional caches consult. Useful when you want only one origin fetch per region.\n  Origin: the actual content source. Should see < 0.5% of total traffic.\n\nMath: 1M requests at L1 with 90% hit -> 100K L2 lookups. At 95% L2 hit -> 5K origin requests, with most of those collapsed if origin shield is used. Origin sees < 1% of edge traffic.' },
      { section: 'Cache Key, Vary, and Variant Selection', content: 'The cache key determines what counts as "the same object." Typically (host, path, query_string), with Vary headers expanding the key for variants:\n\n  Vary: Accept-Encoding -> separate cache entries for gzip, brotli, identity.\n  Vary: Accept-Language -> per-language variants.\n  Vary: User-Agent (rare) -> separate mobile and desktop.\n\nVary multiplies cache slots; too many Vary values fragment the cache and tank hit ratio. Best practice: normalise variants on the origin (e.g., always serve gzip if accepted) and Vary on as few headers as possible.\n\nQuery-string normalisation is also important: ?utm_source=foo and ?utm_source=bar should usually hit the same cached object. Configure the cache to ignore tracking params; otherwise hit ratio collapses.' },
      { section: 'TTLs and Cache-Control', content: 'The origin signals freshness via headers:\n  Cache-Control: public, max-age=3600 -> client and CDN cache for 1 hour.\n  Cache-Control: public, max-age=60, s-maxage=86400 -> client caches for 60s, CDN for 24h.\n  Cache-Control: private, no-store -> bypass CDN entirely.\n  ETag / Last-Modified -> revalidation tokens for conditional requests.\n\nDefault TTLs by content type:\n  Images, JS, CSS, video segments: 1 year (immutable — change the URL to invalidate).\n  HTML pages: short (seconds to minutes) so updates propagate quickly.\n  API responses: short or no-cache, depending on whether the API is GET-cacheable.\n\nThe pattern of "long TTL on immutable URLs, short TTL on mutable" is the bedrock of CDN strategy. Hash content URLs (app.a8f3.js -> app.b2c4.js after change) so old URLs stay cached and new ones invalidate by being new.' },
      { section: 'Content Invalidation', content: 'Three mechanisms, in order of cost:\n\n  TTL expiry: cheap, automatic, but slow. Set TTL = how long you can tolerate stale content.\n  Versioned URLs: change the URL when content changes (cache-busting). The old URL stays cached uselessly; the new one fills cleanly. Used universally for assets.\n  Active purge: origin calls the CDN purge API with a URL or pattern. CDN control plane propagates the invalidation to every edge.\n\nActive purge propagation: control plane publishes to a pub/sub topic; every edge subscribes; on receipt, evict the matching keys. End-to-end latency: <30 seconds typically. Pattern purges (e.g., /api/users/*) are heavier — requires every edge to scan its cache index.\n\nDesign for invalidation rarity: if you need to purge tens of thousands of URLs per minute, your TTL is wrong. Most platforms tune so active purge is exceptional, not routine.' },
      { section: 'Origin Fetch and Shielding', content: 'When a cache misses all tiers, an origin fetch happens. To prevent a single popular cold object from triggering thousands of simultaneous origin requests:\n\n  Request coalescing: at each PoP, only one fetch goes to origin per (object, time-window). Other concurrent miss requests wait for that fetch to complete.\n  Origin shield: route all regional-tier misses through one designated PoP per region. The shield deduplicates further, ensuring at most one origin request per object per region.\n\nOrigin connections are connection-pooled and use HTTP/2 to multiplex many requests on few TCP connections. Hopefully fewer than 100 long-lived connections from CDN to origin handle all the traffic from a region.' },
      { section: 'TLS Termination at Edge', content: 'TLS terminated at the edge. Each PoP holds the cert and key in memory (encrypted at rest, decrypted at boot from a secrets system). Benefits:\n\n  Latency: TLS handshake takes 2-3 RTTs (TLS 1.2) or 1 RTT (TLS 1.3). Doing it against the local edge instead of the origin cuts handshake time from 300-450ms to 20-30ms.\n  Connection reuse: client uses one TLS session to the edge across many requests (HTTP/2 multiplexing).\n  Origin offload: origin does not handle TLS at all (CDN fetches origin over HTTPS with its own pooled connections).\n\nCert management: SNI to select cert per domain (multi-tenant SaaS often has thousands of certs). Auto-renewal via ACME (Let\'s Encrypt or internal CA). Hot reload — no edge restart when certs rotate. OCSP stapling: the edge attaches a recent OCSP response to the handshake so the client does not have to make a separate revocation check.' },
      { section: 'Cache Replacement: LRU and Beyond', content: 'Edge cache disks are smaller than the total content set, so something must be evicted. Standard policies:\n\n  LRU (Least Recently Used): evict the object accessed longest ago. Cheap, good general-purpose.\n  LFU (Least Frequently Used): evict the lowest hit count. Better for skewed distributions but hard to track.\n  ARC (Adaptive Replacement Cache): combines recency and frequency, adapts to workload. More complex.\n  Size-aware: prefer evicting large objects (one 1GB video vs 100 10MB images) — saves more space per eviction.\n  Cost-aware: weight by miss cost (origin fetch latency, bandwidth). Useful when some content is more expensive to fetch than others.\n\nProduction CDNs usually run an LRU variant tuned with admission control: do not even cache an object on first miss unless it has been seen N times (prevents one-off downloads from evicting popular content). The combination of admission + LRU performs nearly as well as LFU at a fraction of the cost.' },
      { section: 'DDoS and WAF at the Edge', content: 'The CDN sits in front of the origin and is the natural place to mitigate attacks:\n\n  Volumetric: anycast spreads attack traffic across all PoPs. Each PoP absorbs its share locally; no single point overwhelmed.\n  Application-layer (L7): WAF rules at the edge filter malicious requests (SQL injection patterns, bot signatures, geographic blocks).\n  Rate limiting: per-IP rate limits enforced at the edge prevent any one client from overwhelming the origin.\n  Bot detection: signature-based and behavioural; CAPTCHA challenges for suspicious clients.\n\nThe origin sees only filtered traffic. A 1Tbps DDoS that would crush a single origin is absorbed by 100 PoPs each handling 10Gbps locally.' },
      { section: 'Logging and Real-Time Analytics', content: 'Every request emits an access log at the edge. Volume is enormous (millions per second globally), so logs are sampled and aggregated locally before shipping:\n\n  Per-edge: log to local fast disk, batch every minute.\n  Per-region: aggregator collects from edges, computes summaries (request count by status, by content type, by origin).\n  Global: centralised analytics ingests aggregates; raw logs land in a data lake for ad-hoc query.\n\nReal-time metrics (cache hit ratio per PoP, request rate, error rate) flow through Kafka or a similar low-latency pipeline so dashboards refresh every few seconds. Customer-visible analytics (per-domain request count, bandwidth) feed billing and dashboards.' },
      { section: 'Failure Modes and Recovery', content: 'Edge PoP fails: BGP withdraws the anycast prefix; clients re-route to next-closest PoP within seconds. DNS-based routing takes longer to converge (TTL-bound) but the same mechanism applies — pull the failing PoP from rotation.\n\nMid-tier cache failure: edges fall through to origin (or next-tier cache if multi-tier). Origin load spikes; auto-scale or shed non-critical traffic.\n\nOrigin down: cached content keeps serving from edges. Stale-while-revalidate lets edges serve stale content while origin is unreachable, then refresh when origin recovers. Cache-Control: stale-while-revalidate=86400 — serve stale for up to 24 hours during origin outage.\n\nCert expiry: monitoring alerts on certs nearing expiry. Auto-renewal handles the common case; manual intervention for edge cases (cert authority outage, DNS issues blocking ACME challenges).\n\nThundering herd on cold cache: request coalescing at each tier and origin shield prevent simultaneous misses from cascading.' },
      { section: 'Observability', content: 'Hot metrics by region and PoP:\n  cache_hit_ratio_l1, _l2 (alert if < 90%)\n  request_rate, error_rate by status_code\n  origin_fetch_latency (alert > 500ms)\n  tls_handshake_latency_p99 (alert > 50ms)\n  bandwidth_egress (capacity planning)\n  active_connections per edge (saturation)\n  purge_propagation_latency (alert > 60s)\n\nPer-customer dashboards: a customer wants to see hit ratio, request count, and origin bandwidth for their domain. Build customer-segmented metrics from the same log pipeline.\n\nGlobal map view: real-time PoP status (healthy, degraded, down) on a world map for the NOC. Capacity utilisation per PoP feeds traffic management — shift load away from saturated PoPs.' },
      { section: 'Scaling Levers', content: 'Three dimensions:\n\n  Geographic coverage: more PoPs reduce average latency. Diminishing returns past ~200 PoPs; beyond that, the gain is mostly in poorly-served regions (Africa, parts of Asia) where each new PoP serves a population not well covered.\n\n  Cache capacity per PoP: bigger SSDs hold more long-tail content. Each doubling of cache capacity adds a few percentage points to hit ratio. Cost-effective until you outgrow the edge form factor.\n\n  Tier depth: adding an L3 origin shield drops origin requests further but adds latency on cold misses. Worth it when origin is expensive (compute-bound API, paid bandwidth) or rate-limited.\n\n  Smart routing: real-time selection of best PoP per client using BGP and latency data (not just topology). Used by premium CDN tiers; complex to operate.\n\n  Compression and image optimisation at the edge: serve modern formats (WebP, AVIF for images; brotli for text) automatically based on client capabilities. Saves bandwidth, indirectly raises effective cache capacity.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Browser[Browser]
        MobileApp[Mobile App]
        VideoPlayer[Video Player]
    end
    subgraph Edge
        GeoDNS[Geo-DNS Anycast]
        EdgePoP[Edge PoP L1 Cache]
        TLS[TLS Termination at Edge]
        WAF[WAF and DDoS Shield]
    end
    subgraph Services
        MidTier[Mid-tier Regional Cache L2]
        PurgeAPI[Purge and Invalidate API]
        Control[Control Plane]
        OCSP[OCSP Stapling Service]
    end
    subgraph Async
        Gossip[Invalidation Gossip]
        LogAgg[Edge Log Aggregator]
        PrefetchJob[Prefetch and Prewarm Job]
    end
    subgraph Storage
        EdgeSSD[(Edge SSD Cache)]
        MidHDD[(Mid-tier HDD Cache)]
        Origin[(Origin Server)]
        CertStore[(TLS Cert Store)]
    end
    subgraph Analytics
        EventBus[Kafka Access Logs]
        Lake[(Data Lake)]
    end

    Browser -->|DNS query| GeoDNS
    MobileApp -->|DNS query| GeoDNS
    GeoDNS -->|nearest PoP IP| Browser

    Browser -->|HTTPS request| TLS --> WAF --> EdgePoP
    EdgePoP --> EdgeSSD
    EdgePoP -->|L1 miss| MidTier --> MidHDD
    MidTier -->|L2 miss| Origin
    Origin --> MidTier --> EdgePoP --> Browser

    VideoPlayer -->|segment fetch| EdgePoP
    TLS --> CertStore
    TLS --> OCSP

    Origin -->|purge call| PurgeAPI --> Control --> Gossip
    Gossip --> EdgePoP
    Gossip --> MidTier

    Control --> PrefetchJob --> EdgePoP

    EdgePoP --> EventBus --> LogAgg --> Lake

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class EdgeSSD,MidHDD,Origin,CertStore storage
    class Gossip,LogAgg,PrefetchJob async
    class GeoDNS,EdgePoP,TLS,WAF edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Anycast vs DNS-based geo-routing', rationale: 'Anycast is faster (no extra DNS round-trip), handles failover instantly through BGP withdrawal, and is the right pick for critical IPs (DNS itself, control plane). DNS-based gives finer geographic control (route per ASN, per country) and is easier to A/B test changes. Most large providers use anycast for stability-critical traffic and DNS-based for content where geo-precision matters.' },
      { decision: 'Single-tier (edge only) vs multi-tier (edge + regional + shield)', rationale: 'Single-tier is simpler and minimises latency for the cache-hit case, but every cold miss hits origin and origin must handle the aggregate miss load from every PoP. Multi-tier shields origin at the cost of one extra RTT on cold misses. For any origin that cannot handle full edge-miss volume (most origins), multi-tier is necessary. The added RTT is hundreds of microseconds inside a region — negligible compared to origin fetch latency.' },
      { decision: 'Long TTL with active purge vs short TTL with no purge', rationale: 'Long TTL gives high hit ratio and low origin load but requires a reliable purge API for content updates. Short TTL means content updates propagate naturally without purge but origin load is much higher. The right answer is "long TTL on immutable, versioned URLs" — change the URL when content changes and never purge. Active purge is reserved for emergency (legal takedown, content takedown).' },
      { decision: 'Pre-positioning content vs lazy cache-fill', rationale: 'Pre-positioning pushes content to PoPs before users request it — first-viewer latency is zero, no cold-miss. Lazy fill is cheaper (only popular content gets cached) but creates a cold-miss period for new viral content. Pre-position when origin cannot handle the cold-miss burst (live streams, scheduled product launches) and rely on lazy fill for the long tail.' },
      { decision: 'CDN-managed certs vs customer-managed certs', rationale: 'CDN-managed certs (via ACME and Let\'s Encrypt) automate the entire cert lifecycle and rotate without customer involvement. Customer-managed (you upload your own cert) is required for some compliance scenarios and for EV certificates. Default to CDN-managed; offer custom upload for the regulated cases.' },
    ],
    keyTakeaways: [
      'A tiered cache hierarchy (edge, regional, origin shield) is the difference between an origin that serves <1% of traffic and one that melts during viral events',
      'Anycast plus BGP gives you instant failover for nothing; DNS-based routing gives finer geo control but slower convergence',
      'Long TTLs on versioned, immutable URLs combined with cache-busting via URL change is the standard pattern — active purge should be the exception, not the routine',
      'TLS termination at the edge cuts handshake time from hundreds of milliseconds to tens — second-biggest performance win after caching itself',
      'Request coalescing and origin shielding stop thundering herds from collapsing the origin during cold-content bursts',
      'Cache-hit ratio is the single number that captures CDN value; everything in the design is in service of moving it from 85% to 95%',
    ],
    faqs: [
      { question: 'How does a CDN handle dynamic content that cannot be cached?', answer: 'Two patterns. First, accept that dynamic responses go to origin every time, and use the CDN only for TLS termination, geographic routing, and DDoS protection. The latency improvement comes from doing TLS handshake at the nearby edge, then forwarding over a fast pooled connection to origin (often 30-50ms saved). Second, edge compute: run small functions (Cloudflare Workers, Lambda@Edge) at the edge that personalise responses and assemble pages from a mix of cached fragments and dynamic API calls. The fragments cache; the personalised assembly does not. This is how modern e-commerce sites serve personalised pages with sub-100ms TTFB.' },
      { question: 'Why is cache hit ratio expressed as a percentage, and what counts as "good"?', answer: 'Hit ratio = requests served from cache / total requests. The denominator is what makes interpretation tricky — request counts can be dominated by a few popular objects (hit ratio looks great) or by a long tail of singletons (hit ratio looks bad). Byte hit ratio (bytes served from cache / total bytes) is often more useful for cost. Industry baselines: 85% byte hit ratio for general web content, 90%+ for video segments (large, repeatedly accessed), 95%+ for image-heavy sites. Below 70% you have a cache-key or TTL bug; above 95% you have either lots of repeat traffic or a deliberately tuned long-TTL strategy.' },
      { question: 'What goes wrong with Vary headers and cache fragmentation?', answer: 'Every distinct value of every Vary header creates a separate cache entry. Vary: Accept-Encoding (gzip, br, identity) triples the cache slots for one URL. Vary: User-Agent — there are millions of unique user agents — explodes the cache. The classic mistake is "Vary: *" (vary on every header) which makes the cache useless. Best practice: normalise variants on the origin (always serve brotli if accepted), Vary on only the smallest necessary set of headers, and never Vary on User-Agent without a strict normalisation rule (collapse to mobile/desktop, ignore the rest).' },
      { question: 'How fast does an active purge actually propagate?', answer: 'Targets are usually <30 seconds globally for a single-URL purge. The mechanism: control plane publishes the purge to a pub/sub bus; every edge subscribes; on receipt, the edge marks the cache key invalid (next request triggers re-fetch) or actively evicts. Pattern purges (purge /api/users/*) are heavier because every edge has to scan its cache index — typically 1-5 minutes for wide patterns. For really fast emergency purges, some CDNs offer "instant purge" via a more aggressive push mechanism at <5 seconds. Best practice is to design so frequent purge is not needed (use versioned URLs); purge stays for rare emergencies.' },
      { question: 'Why anycast for DNS but DNS-based routing for content?', answer: 'DNS itself is latency-critical (one slow DNS lookup makes everything else slow), and DNS responses are small (no benefit from a heavier-weight content cache). Anycast routes the client to the topologically nearest DNS server in microseconds. Content routing needs to be smarter — you might want a specific PoP for a specific ISP\'s users, or to balance load across regions in a way BGP cannot express. DNS-based content routing gives that fine control. The two layers play together: anycast gets you to the right DNS server fast; DNS gives you the right content PoP based on policy.' },
      { question: 'How do you keep one popular cold object from collapsing the origin (thundering herd)?', answer: 'Three defences. First, request coalescing at each PoP — only one fetch goes to origin per (key, time-window) and other concurrent requests wait. Second, origin shielding — only one designated PoP per region calls origin, so origin sees one request per region instead of one per PoP. Third, stale-while-revalidate — if a cached object expires, serve the stale version to the requester while one background fetch refreshes it. Combined, a viral cold object generates a handful of origin requests instead of thousands. Without these, the first burst of traffic on a launched product page can take origin down within seconds.' },
      { question: 'How does the CDN authenticate origin fetches?', answer: 'Two mechanisms commonly used. First, IP allowlists — the origin firewall only accepts requests from CDN IP ranges. Cheap but brittle (IP ranges change). Second, signed headers — the CDN signs its requests with a shared secret or mTLS cert; origin validates. mTLS is the production-grade answer: a cert issued to the CDN that the origin trusts, rotated regularly. This prevents a misconfigured firewall from leaking origin to bypassing clients and lets origin reject requests that did not come through the CDN. Combine with private network (origin only listens on a VPC IP) for defence in depth.' },
      { question: 'What is the difference between an edge function and a service mesh sidecar?', answer: 'Both intercept and modify requests, but they live at different layers. An edge function (Cloudflare Workers, Lambda@Edge) runs at the CDN PoP, before the request reaches your origin. It can modify the request, serve cached content, fetch from origin, and assemble responses — all close to the client. A service mesh sidecar (Envoy, Linkerd) runs alongside each backend service, intercepting service-to-service traffic for mTLS, routing, retries. Edge functions optimise client-facing latency and personalisation; sidecars optimise inter-service reliability. They are complementary, not alternatives.' },
      { question: 'How do you decide how many PoPs you need?', answer: 'Per-PoP cost is roughly fixed (rack, peering, transit). The benefit scales with the population you serve from that location. Run a simulation: for each potential PoP location, count how many users would have lower latency, and the bandwidth savings from local serving versus remote. PoPs in dense regions (Frankfurt, Singapore, Northern Virginia) pay for themselves quickly because they serve millions; PoPs in remote regions (Antananarivo) only make sense if you have a customer requirement or government compliance need. Most major CDN providers run 100-300 PoPs; the marginal value of PoP 301 is much lower than PoP 11.' },
      { question: 'How would you design a CDN for a single application versus a multi-tenant CDN?', answer: 'A single-application CDN can take shortcuts: TTLs known per content type, no per-customer config, no multi-tenancy isolation. Caching is hand-tuned to the app\'s URL patterns and update cadence. A multi-tenant CDN must isolate every customer\'s config and traffic — one customer\'s aggressive purge cannot delay another\'s; one customer\'s bad cert cannot break another\'s TLS. Every per-customer setting (TTL overrides, WAF rules, geo-blocks) needs a config schema with versioning and rollback. The core caching engine is the same; the difference is in the control plane and isolation. Use a single-purpose CDN when you control both the origin and the consumers; use a multi-tenant one when you need to expose CDN configuration to external customers.' },
    ],
  },
  {
    id: 8,
    slug: 'design-netflix',
    title: 'Design Netflix',
    difficulty: 'Hard',
    category: 'Content Delivery',
    tags: ['streaming', 'cdn', 'recommendations', 'encoding'],
    problemStatement: `Design a video streaming platform like Netflix. Users browse a catalog, select titles, and stream high-quality video globally. Target: 200M subscribers, 100M concurrent streams at peak.`,
    requirements: {
      functional: ['Browse and search video catalog', 'Stream video with adaptive quality', 'Continue watching from where left off', 'Personalized recommendations', 'Multiple user profiles per account'],
      nonFunctional: ['Playback start < 3s', 'Buffering < 0.5% of watch time', 'Global CDN coverage', 'Support 100M concurrent streams'],
    },
    capacityEstimates: `100M concurrent streams × 5Mbps avg = 500 Tbps\nCatalog: 15,000 titles × 50 encoding variants × 30GB = 22 PB\nOpen Connect CDN: 17,000+ PoPs globally`,
    solutionBreakdown: [
      { section: 'What Makes Netflix Different from YouTube', content: 'Both are video streaming, but the workload shape diverges in important ways. Netflix has a small (tens of thousands of titles) curated catalog versus YouTube\'s billions. Every Netflix title is watched many times; YouTube has a heavy long tail of single-view uploads. Netflix is subscription-driven (no ads in many tiers), so the unit economics are about subscriber retention, not ad revenue per view. And critically, every title is pre-licensed and pre-encoded — there is no user upload pipeline.\n\nThis shifts the design dramatically. The encoding pipeline is offline and one-time per title. The CDN can pre-position everything because the catalog fits. The recommendation system is the single biggest engineering lever, because it drives subscriber retention. Live streaming is a separate side problem.' },
      { section: 'Open Connect (Netflix CDN)', content: 'Netflix operates its own CDN (Open Connect Appliances, OCAs) embedded inside ISP networks. ISPs install OCAs in their data centers for free; Netflix pays for hardware, the ISP provides rack space and power. The ISP wins because Netflix traffic stops crossing their peering link.\n\nFlow: a viewer in (say) a Comcast home requests playback. The Netflix control plane returns CDN URLs pointing to the Comcast OCA. The viewer streams from a server inside Comcast\'s network — single-digit-ms latency, no internet transit. Netflix saves billions in CDN and transit costs annually.\n\nOCA fill: every night, an offline pipeline pre-positions the next 24 hours of expected popular content to each OCA based on regional viewing patterns. Long-tail content is filled on demand from regional caches. Hit ratio at the OCA is >95% for prime-time traffic.' },
      { section: 'Encoding Pipeline', content: 'Each title is encoded into ~1,000+ variants:\n  Resolutions: 144p, 240p, 360p, 480p, 720p, 1080p, 1440p, 4K, HDR variants.\n  Codecs: H.264 (universal compatibility), H.265 (~30% smaller), AV1 (~50% smaller than H.264).\n  Bitrates per resolution: bitrate ladder tuned per title.\n  Audio: stereo, 5.1, Atmos, multiple languages, audio description.\n\nEncoding happens in S3 / cloud workers, not at the CDN. Mezzanine masters (lossless or near-lossless source) live in cold S3. Encoding jobs are batched overnight; new titles can take days to fully encode across all variants. Once encoded, variants are pushed to OCAs ahead of expected demand.\n\nPer-scene encoding: instead of using a fixed bitrate ladder for the whole title, the encoder analyses the source for complexity (slow drama scenes vs high-motion action) and adjusts bitrates per scene. Saves ~20% bandwidth across the catalog at equivalent quality.' },
      { section: 'Adaptive Bitrate Streaming with BOLA', content: 'The player runs the BOLA (Buffer Occupancy Lyapunov Algorithm) algorithm: it picks the bitrate that maximises buffer health and quality jointly. Conceptually: if the buffer is high, take a higher quality (we can afford to risk a download exceeding playback rate). If the buffer is dropping, take a lower quality.\n\nBOLA outperforms pure throughput-based ABR because it directly optimises for the metric viewers actually feel (rebuffering events). Tuned by simulation on real measured network traces.\n\nSegments are typically 4-6 seconds for VOD, encoded as fMP4 with HLS and DASH manifests. The player picks initial bitrate based on connection type, then adapts within seconds.' },
      { section: 'Playback Authorisation and DRM', content: 'Every play request flows through:\n  1. Auth: user logged in? subscription active?\n  2. Concurrent stream limit: how many devices already streaming?\n  3. Geographic licensing: is this title licensed in the user\'s region?\n  4. DRM license: generate a per-session DRM license bound to the device.\n  5. CDN URL signing: return manifest URLs signed with a short-lived (4h) token.\n\nDRM (Widevine, FairPlay, PlayReady depending on platform) encrypts segments at the CDN; only a valid DRM license decrypts them. Licenses bind to a specific device, so a copied URL is useless without the matching DRM session. This is the contractual requirement from studios — Netflix could not license content without strict DRM.' },
      { section: 'Recommendation Engine', content: 'The single biggest engineering investment. Pipeline:\n\n  Candidate retrieval (offline, Spark): for each user, generate ~10,000 candidate titles from the full catalog using collaborative filtering, content-based similarity, and behavioural embeddings.\n\n  Online ranker (per-request, sub-second): take the candidate list, score each with a deep model using hundreds of features (recent watch history, time of day, device, freshness in catalog, completion rates for similar titles), return top-N.\n\n  Personalised UI: every row on the home page is a separately-ranked list with its own model — "Because you watched X," "Top 10 in your country," "New releases," each populated by a row-specific ranker.\n\nA/B testing infrastructure runs thousands of experiments simultaneously. Every UI change, every model variant, every row ordering is tested with rigorous statistical methodology. Models are retrained continuously on engagement data.' },
      { section: 'Thumbnail Personalisation', content: 'Different users see different cover images for the same title. The thumbnail is itself a recommendation surface. Netflix generates dozens of artwork variants per title; the ranker picks the one most likely to engage each viewer based on past click-through patterns.\n\nMechanism: pre-render ~20 variants per title (different stars, different scenes, different moods). Online model scores variants for each user; pick the highest-scoring. Click events feed back into training data. The result: viewers who like action see action thumbnails; viewers who like romance see romance thumbnails — for the same movie.\n\nThis is a small UI detail with measurable retention impact, justifying significant engineering investment.' },
      { section: 'Playback State and Continue Watching', content: 'The "where I left off" state is a high-write-rate workload. The player sends position updates every 5-10 seconds during playback. Stored in Cassandra:\n  view_state(user_id, content_id, position_sec, last_updated_at, completion_pct)\n\nPartitioned by user_id, clustered by content_id. Reads are 1:1 by (user, content) — single-partition lookup. Writes are constant but small.\n\nLast-write-wins for concurrent sessions on different devices. The player sometimes shows a "Resume on TV" prompt if it detects a recent same-content view on another device — the state is shared, the device knows about other devices via the playback service.' },
      { section: 'Metadata Catalog', content: 'Compared to YouTube\'s billion titles, Netflix\'s catalog is small (~15K titles per region). The catalog database is a curated relational store with:\n  titles(content_id PK, type, original_language, runtime_sec, mpaa_rating, ...)\n  title_translations(content_id, language, title, description, ...)\n  title_artworks(content_id, artwork_id, variant_class, s3_url, ...)\n  cast(content_id, person_id, role, billing_order)\n  genres, tags, etc.\n\nLicensing constraints by region — a title may be available in the US but not in Germany. region_availability(content_id, region_code, available_from, available_to) gates what each user can see.\n\nThe catalog is mostly-read; updates happen at title-launch cadence (handful per day). Cached aggressively, served from CDN-fronted catalog APIs. Updates trigger cache invalidation per region.' },
      { section: 'Search', content: 'Elasticsearch over (title, cast, directors, tags). Cross-language search uses a multi-language indexer. Search is a separate read path from browse; it powers the search box and "more like this" suggestions inside titles.\n\nNetflix search has a personalisation layer too — autocomplete suggestions are biased by user watch history and global popularity. Search results are reranked using a smaller version of the home-page model.' },
      { section: 'Profiles and Households', content: 'A subscription has multiple profiles (kids, adults, separate viewing histories). Each profile has its own view state, recommendation features, and parental controls. Storage: profiles(account_id PK, profile_id CK, name, avatar, age_class, language_pref).\n\nThe household question is contractual — Netflix\'s subscription is "per household," not per user. Detection: device IPs, GPS hints, login patterns. Crackdown on cross-household sharing requires a careful UX (offer to add an extra paid member rather than just blocking access).' },
      { section: 'Live Events', content: 'Netflix is moving into live streaming (sports, comedy specials) which is a different problem from VOD. Live ingest: feed from production team via RTMP or SRT to a transcoding farm that produces HLS/DASH variants in real time. Segments push to OCAs every few seconds, with a rolling window of last ~4 hours kept on origin.\n\nLatency target: <30 seconds for typical events, with LL-HLS for time-sensitive content. Live consumes much more origin bandwidth per viewer than VOD because there is no time to pre-position content. Scaling assumption: 200M subscribers might watch the same live event simultaneously, which is the throughput stress test for OCAs.' },
      { section: 'Failure Modes and Recovery', content: 'OCA failure: the playback service routes the viewer to a fallback OCA (same content, different cache fill source) or to a regional cache. Brief buffering possible during failover.\n\nMass content delivery event (e.g., new season release): traffic surges to specific titles. OCA pre-positioning handles known launches; for unexpected viral spikes (e.g., Squid Game), the system falls back to regional cache fills and accepts brief degraded quality for a few hours.\n\nDRM license server down: viewers cannot start new playback (existing sessions continue until license expires). Failover via a secondary DRM provider, kept active for exactly this.\n\nRecommendation service degraded: fall back to a per-region "popular now" list. Acceptable as a degraded experience for hours; lost engagement is the cost.\n\nView state Cassandra lag: viewers see stale "continue watching" but playback works. Reconciles within seconds.' },
      { section: 'Observability', content: 'Key SLIs:\n  playback_start_latency_p99 (alert > 3s)\n  rebuffering_ratio (alert > 0.5% of watch time)\n  per_region_bitrate_distribution (alert if drop in 1080p+ playback)\n  oca_cache_hit_ratio (alert < 95%)\n  drm_license_failure_rate (alert > 0.1%)\n  subscription_churn_indicators (longer-term, retention metric)\n\nA "Quality of Experience" (QoE) score per viewer session: weighted combination of startup latency, rebuffer count, average bitrate, and 4K availability. Drift in QoE per region triggers infrastructure investigation; persistent drift in QoE per device class triggers client-side investigation.\n\nReal-time per-title viewership dashboards for content teams during launches — see how many viewers, what regions, what bitrates within seconds of viewing.' },
      { section: 'Scaling Levers', content: 'Per-axis:\n\n  Bandwidth: AV1 over H.264 saves ~50% per stream. Roll out AV1 to compatible devices first; legacy devices keep H.264. As device support grows, average bandwidth per stream drops without engineering effort.\n\n  Encoding cost: per-scene encoding saves ~20% at equivalent quality. Encoding ladder optimisation per title (do not encode every resolution for short clips) saves storage and encoding compute.\n\n  CDN: more OCAs deeper into ISP networks moves the cache closer to the viewer. Diminishing returns past the largest 100 ISPs in each region.\n\n  Recommendations: improvements in retention compound — a 1% reduction in churn pays for years of recommendation engineering. The team treats this as the primary investment.\n\n  Live concurrency: requires a totally different OCA strategy. Pre-warm OCAs with manifest URLs ahead of event start; size the encoding farm for peak segment generation rate.' },
    ],
    diagram: `graph TB
    subgraph Clients
        TV[TV App]
        Mobile[Mobile App]
        Web[Web Player]
    end
    subgraph Edge
        GeoDNS[Geo-DNS]
        OC[Open Connect ISP Appliances]
        Origin[Origin CDN Tier]
    end
    subgraph Gateway
        APIGW[API Gateway]
        Auth[Auth and Profile Svc]
    end
    subgraph Services
        Catalog[Catalog Service]
        SearchSvc[Search Service]
        Playback[Playback and License Svc]
        Recs[Recommendation Svc]
        Cont[Continue Watching Svc]
        Bill[Billing Service]
        AB[A B Test Service]
        ThumbPers[Thumbnail Personalization]
    end
    subgraph Async [Encoding and ML]
        EncQ[Encoding Queue]
        Encoder[Per-Scene Encoder H264 H265 AV1]
        ThumbGen[Thumbnail Variant Generator]
        RecTrain[Rec Model Spark Training]
        Prepos[Pre-positioning Job]
    end
    subgraph Storage
        Master[(Mezzanine Masters S3)]
        Variants[(Encoded Variants S3)]
        CatDB[(Catalog DB)]
        ES[(Elasticsearch)]
        ViewState[(View State Cassandra)]
        UserDB[(User and Profile DB)]
        BillDB[(Subscriptions DB)]
    end
    subgraph Analytics
        EventBus[Kafka Events]
        Lake[(Data Lake)]
        Feature[Feature Store]
    end

    Mobile -->|browse| APIGW --> Auth
    APIGW --> Catalog --> CatDB
    APIGW --> Recs --> Feature
    APIGW --> ThumbPers --> Feature
    APIGW --> Cont --> ViewState
    TV -->|search| APIGW --> SearchSvc --> ES

    Mobile -->|play title| APIGW --> Playback
    Playback --> Auth
    Playback --> Cont
    Playback -->|signed manifest URL| Mobile
    Mobile -->|DNS| GeoDNS --> OC
    Mobile -->|manifest and segments| OC
    OC -->|cache miss| Origin --> Variants
    Mobile -->|playback heartbeat| EventBus
    Playback --> AB

    Web -->|billing| APIGW --> Bill --> BillDB

    Master -->|new title| EncQ --> Encoder --> Variants
    Encoder --> ThumbGen --> Variants
    Variants --> Prepos --> OC

    EventBus --> Lake --> RecTrain --> Feature
    Auth --> UserDB

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class Master,Variants,CatDB,ES,ViewState,UserDB,BillDB storage
    class EncQ,Encoder,ThumbGen,RecTrain,Prepos async
    class GeoDNS,OC,Origin edge
    class EventBus,Lake,Feature analytics`,
    tradeoffs: [
      { decision: 'Operate own CDN (Open Connect) vs third-party (Akamai, Cloudflare)', rationale: 'Operating Open Connect costs hundreds of millions in hardware and engineering, but it saves billions in transit and CDN fees at Netflix scale, and the embedded-in-ISP architecture is uniquely good for video. Third-party CDNs handle smaller-scale platforms well — switching to your own makes sense only when video bandwidth dominates your cost line, which happens at ~10% of Netflix-scale traffic. Cloudflare and Akamai also offer pre-positioned video offerings that are good enough for most platforms.' },
      { decision: 'Pre-position every title to every OCA vs lazy fill', rationale: 'The catalog is small enough that filling every OCA with the top titles in each region is feasible — content economics support it. Lazy fill (only popular content cached, long tail filled on demand) is what YouTube uses because their catalog is too large to pre-position. For Netflix-shaped catalogs, pre-positioning to peak demand is the right call; the bandwidth saving exceeds the storage cost.' },
      { decision: 'Per-scene bitrate encoding vs static bitrate ladder', rationale: 'Per-scene encoding requires content-aware analysis during encoding and produces a different bitrate ladder per title — more storage variation, more complex encoding pipeline. It saves ~20% bandwidth at equivalent quality. At Netflix scale, that 20% pays for the engineering many times over per year. At smaller platforms with cheaper CDN bills, the engineering complexity may not be worth it.' },
      { decision: 'Thumbnail personalisation vs uniform thumbnails', rationale: 'Personalising thumbnails per user is significant engineering work (pre-render variants, online ranking, click-feedback loop) for a small UI change. Measured retention impact justifies the investment at scale because retention is the primary metric. Smaller platforms with less data to train on cannot run this profitably; uniform editorial-chosen thumbnails work fine.' },
      { decision: 'Cassandra for view state vs Redis vs sharded SQL', rationale: 'Cassandra handles the constant write rate from heartbeats across 200M subscribers cleanly, scales linearly with nodes, and the 1:1 read pattern (user_id, content_id) maps to single-partition lookups. Redis would be faster but the data set is too large to keep entirely in memory. Sharded SQL works but requires explicit sharding and re-sharding as the user base grows. For "high write rate, partition-key lookups, eventually consistent" workloads, Cassandra is the obvious pick.' },
    ],
    keyTakeaways: [
      'Open Connect is the financial keystone — embedding CDN servers in ISPs eliminates internet transit and saves billions at scale',
      'Per-scene encoding plus modern codecs (AV1) is how you cut average bandwidth per stream over time without changing the playback experience',
      'BOLA-style buffer-aware ABR optimises directly for rebuffering events — the metric viewers actually feel',
      'Recommendations and thumbnail personalisation drive retention more than any infrastructure improvement; the engineering investment there returns more than any other lever',
      'DRM and signed URLs are mandatory for the content licensing contracts — designing them in early avoids painful retrofits',
      'View state is high-volume but simple-shaped (key lookup); Cassandra is the right answer for it at any meaningful scale',
      'Live streaming is a separate engineering effort from VOD — overlapping infrastructure exists, but capacity planning and OCA strategy differ fundamentally',
    ],
    faqs: [
      { question: 'Why does Netflix build its own CDN instead of paying Akamai or Cloudflare?', answer: 'Bandwidth economics. At Netflix\'s scale (terabits per second of egress), commercial CDN fees are billions per year. Open Connect lets Netflix embed cache servers directly in ISP networks for free (the ISP pays for power and rack space because Netflix traffic stops crossing their peering links). The result: video bytes go from a server inside the user\'s ISP to the user — no internet transit, single-digit-ms latency. Netflix pays for the hardware and operations, which is one-time and amortised. Below ~10% of Netflix scale, commercial CDNs are cheaper than building your own. Above it, Open Connect is the right answer.' },
      { question: 'What is per-scene encoding and why does it matter?', answer: 'A fixed bitrate ladder uses (say) 5 Mbps for every 1080p title. But a slow drama with mostly static shots compresses to 1080p at 2 Mbps with no visible quality difference; a fast action scene needs 8 Mbps to look good. Per-scene encoding analyses each scene\'s complexity and assigns bitrate accordingly. The output is a title-specific ladder where average bitrate per title can drop 20-30%. Multiplied by 200M subscribers and trillions of bytes per month, this saves enormous CDN bandwidth. The cost is encoding complexity — the pipeline must analyse content per scene and produce variable-bitrate outputs — but encoding is a one-time job per title.' },
      { question: 'How do thousands of OCAs stay in sync with the catalog?', answer: 'Two paths. Pre-positioning: a nightly job analyses regional viewing patterns and predicts which titles each OCA should hold. Variants are pushed during off-peak hours over high-bandwidth connections (often 100 Gbps). The job uses historical patterns plus known release schedules to optimise hit ratio for expected next-24-hour demand. On-demand fill: viewer requests a title not in the OCA cache; the OCA fetches from a regional aggregating tier (which itself holds a broader set) or, rarely, from origin. Origin sees a tiny fraction of traffic — most fills happen tier-to-tier within the Open Connect network.' },
      { question: 'How does DRM work without making playback feel slow?', answer: 'License acquisition runs in parallel with manifest loading. When the user hits play, the client kicks off three concurrent requests: manifest fetch (HLS or DASH), DRM license request, and first-segment fetch (the segment is encrypted and unplayable without the license but the bytes can flow). All three complete within ~500ms in the happy path. The license is bound to the device (via a hardware-rooted identity in Widevine/FairPlay/PlayReady) and a short session ID, so the same license cannot be reused on another device. License expiry is typically 4-24 hours; renewals happen in the background mid-playback.' },
      { question: 'Why does Netflix personalise even the thumbnails — is that not a tiny detail?', answer: 'Because the home page is the surface where engagement decisions happen. A viewer who likes thrillers might never click on a romance movie shown with a romance thumbnail — but might click if shown with a thriller-flavoured scene from the same movie. Netflix\'s data shows measurable engagement lift from thumbnail personalisation, and engagement maps to retention, which maps to revenue. The engineering cost (pre-rendering variants, online ranking model, click-feedback loop) is a one-time investment that pays back continuously. It looks like a UI detail; it is actually a retention mechanism.' },
      { question: 'How does the recommendation system handle a brand-new title with no engagement data?', answer: 'Cold-start: content-based features fill the gap. A new title is described by its genre, cast, crew, plot tags, similarity embeddings to existing titles, and editorial signals (marketing push). The candidate retrieval system uses these features to surface the new title to users predicted likely to engage. As real engagement data accumulates (hours, days), the model shifts toward collaborative filtering signals which are richer. Editorial overrides push specific launches; "Trending Now" rows give new titles guaranteed surface area in the first week so the algorithm can learn from real signal.' },
      { question: 'What happens if the recommendation service is down?', answer: 'Fall back to per-region popular-now lists, fetched from a pre-computed cache. The home page still works — viewers see a sensible row layout (Trending Now, Top 10, recently added) without personalisation. The degraded experience is noticeably less engaging but not broken. Recovery typically within minutes; lost engagement during the outage is acceptable. The fall-back lists themselves are computed offline so they are independent of the online recommendation service.' },
      { question: 'How is the "Continue Watching" position kept in sync across devices?', answer: 'The player sends position updates every 5-10 seconds during playback via the playback API. The position writes to Cassandra (user_id partition, content_id cluster) with last-write-wins semantics. Other devices reading the position get the latest value within seconds (replication latency). When you open Netflix on a different device, the home page queries view state and shows recent items with their resume positions. If you start playing on the second device, the playback service reads the latest position and seeks to it. Concurrent playback on multiple devices means whichever device wrote last wins — the system does not try to resolve "you watched 5 minutes here and 3 minutes there" semantics.' },
      { question: 'What is the role of AV1 versus H.264, and why is it not just AV1 everywhere?', answer: 'AV1 compresses ~50% smaller than H.264 at the same visual quality. The catch: AV1 decoding requires hardware support that not all devices have, especially older TVs and budget phones. Netflix encodes both: AV1 for devices that support it, H.264 for the long tail. As device support expands (every new phone and TV ships with AV1 decoders by now), the average bitrate per stream falls without any engineering effort — viewers automatically get the better codec. H.265 (HEVC) sits between the two with mixed device support and licensing complexity. The encoder ladder is hardware-aware: it produces only what each target device class can decode.' },
      { question: 'How would the design change for a smaller streaming startup with maybe 1M subscribers?', answer: 'Drop Open Connect entirely — commercial CDNs (Akamai, Cloudflare, AWS CloudFront) are cheaper and easier at that scale. The encoding pipeline can use a fixed bitrate ladder (per-scene encoding pays off only at scale). Recommendations can start with a simpler approach: content-based filtering and editorial curation, adding collaborative filtering as data accumulates. Thumbnail personalisation is not worth the engineering until you have 10M+ subscribers worth of click data. DRM is still mandatory if you license premium content. View state can run on PostgreSQL (sharded by user_id) instead of Cassandra. The core architecture (playback API, signed URLs, ABR streaming, DRM) is the same; the scale-driven optimisations come later.' },
    ],
  },
  {
    id: 9,
    slug: 'design-key-value-store',
    title: 'Design a Key-Value Store',
    difficulty: 'Hard',
    category: 'Storage & Databases',
    tags: ['distributed', 'replication', 'consistency', 'LSM', 'dynamo'],
    problemStatement: `Design a distributed key-value store like Redis or DynamoDB. Support GET, PUT, DELETE operations. The system must be highly available, partition-tolerant, and eventually consistent. Target: millions of keys, microsecond reads, horizontal scalability.`,
    requirements: {
      functional: ['GET(key) → value', 'PUT(key, value)', 'DELETE(key)', 'Optional TTL per key', 'Scan/range queries (optional)'],
      nonFunctional: ['< 1ms P99 read latency', 'Horizontal scaling via consistent hashing', 'Tunable consistency (quorum)', '99.99% availability'],
    },
    capacityEstimates: `10B keys × 1KB avg value = 10TB\nWith 3× replication = 30TB\n1M reads/sec distributed across 100 nodes = 10K reads/sec/node`,
    solutionBreakdown: [
      { section: 'API Surface', content: 'A deliberately tiny API: GET(key), PUT(key, value, [ttl]), DELETE(key), and optional batch variants MGET / MPUT. Each request carries a routing key and an optional consistency level (ONE, QUORUM, ALL). Clients are smart: they hold the ring topology in memory and route directly to the coordinator that owns the key, saving a hop versus a dumb load balancer. Failed routes fall back to a known seed node which proxies and returns updated topology in the response.' },
      { section: 'Data Model', content: 'Internally a key is a byte string up to ~1KB, values up to a few MB (larger payloads belong in a blob store with a pointer here). On disk each record is encoded as length-prefixed key, length-prefixed value, a version vector, a CRC32 checksum, and a tombstone flag.\nKeys are co-located by the high bits of their hash so that range scans within a partition touch a contiguous SSTable region.' },
      { section: 'Consistent Hashing & Virtual Nodes', content: 'Map every key onto a 64-bit hash ring (MurmurHash3 or xxHash). Each physical node owns 128–256 virtual tokens scattered around the ring; this spreads load even when nodes are heterogeneous (a beefier node gets more tokens). A key is owned by the first N clockwise nodes, which become its replica set. When a node joins, it only takes over ~1/N of the keyspace, and the donating nodes stream those SSTables in the background while still serving reads.' },
      { section: 'Quorum Replication', content: 'Default N=3, W=2, R=2 — W+R>N guarantees that any read overlaps with the latest write set, so reads see the latest value barring failures. Strong-read mode uses R=N for read-your-writes; cheap reads use R=1 with the risk of stale data. Coordinator dispatches in parallel to all N replicas, waits for the first W (or R) acknowledgments, then returns. Late responses are still processed in the background to keep replicas in sync.' },
      { section: 'LSM Storage Engine', content: 'Writes go to an in-memory MemTable (a skiplist) and append-only WAL on the same fsync. When the MemTable hits ~64MB it flushes to an immutable SSTable on disk sorted by key. Reads check the MemTable, then SSTables newest-to-oldest using a per-SSTable Bloom filter to skip files that cannot contain the key — typically 1–2 disk seeks for a cold key.\nLeveled compaction (RocksDB-style) merges SSTables across levels in the background, bounding read amplification at O(log N) and reclaiming space from overwrites and tombstones.' },
      { section: 'Vector Clocks & Conflict Resolution', content: 'Each value carries a vector clock — a map of node_id to a monotonic counter. When node A writes, it increments its own entry. On read, if two replicas return values with concurrent clocks (neither dominates), they conflict. Two resolution strategies: last-write-wins via Lamport timestamp (simple, can lose data) or return both siblings to the client for application-level merge (DynamoDB shopping-cart pattern). CRDTs like OR-Sets and PN-Counters give automatic deterministic merge for specific data types.' },
      { section: 'Hinted Handoff', content: 'If a replica is unreachable when the coordinator dispatches a write, another live node accepts the write with a hint (intended_owner=X) and stores it in a local hints table. When X recovers, the hint-holder streams the buffered writes to it and deletes them. Hints have a TTL (e.g., 3 hours) so unbounded unavailability does not balloon disk usage on the hint-holder — beyond that, anti-entropy takes over.' },
      { section: 'Anti-Entropy with Merkle Trees', content: 'Each replica maintains a Merkle tree over its key ranges. Periodically a node exchanges the root hash with peers in its replica set; if the roots differ, they recursively compare child hashes, isolating the diverged sub-range in O(log N) network exchanges. Only the diverged keys are streamed and reconciled. This catches the writes that hinted handoff missed (e.g., when both the primary and hint-holder failed).' },
      { section: 'Read Repair', content: 'When the coordinator detects divergent values among the R replicas it queried, it asynchronously writes the winning value back to the lagging replicas before returning to the client. Combined with quorum reads this self-heals the most-read keys without waiting for anti-entropy. Tradeoff: read repair adds tail latency, so it is throttled — only the top 10% of reads by version mismatch are repaired inline.' },
      { section: 'Membership & Failure Detection', content: 'A gossip protocol (Serf / Cassandra-style) propagates node state every second across a random fanout of 3 peers. Each node maintains a phi-accrual failure detector per peer: instead of a hard timeout, it computes a suspicion level from heartbeat inter-arrival times, suppressing false positives during network blips. A node is marked DOWN only when phi crosses a threshold (e.g., 8) for several seconds.' },
      { section: 'TTLs & Tombstones', content: 'TTL is stored as an absolute expiry timestamp on the record. Reads check expiry and return null for expired keys. Compaction physically removes expired records and tombstones (deleted keys). Tombstones must outlive gc_grace_seconds (default 10 days) so that a recovered node holding an old value cannot accidentally resurrect a deleted key during anti-entropy.' },
      { section: 'Observability', content: 'Per-node and per-key-range metrics: read/write latency P50/P99/P999, replica divergence rate (read repairs / total reads), Bloom filter false-positive rate, compaction backlog, hinted-handoff queue depth. Alerts: P99 read latency above SLA for 5 minutes, compaction backlog > 2 levels, hints queue persistently > 0 for 30 minutes (means a node has been down too long and SLA is at risk).' },
      { section: 'Scaling Levers', content: 'Horizontal: add nodes; consistent hashing rebalances ~1/N of data. Vertical: faster SSDs and more RAM cut tail latency by keeping more SSTables and Bloom filters cached. Hot-key mitigation: detect skew via top-K key sampling on the coordinator and either split the key with a per-shard suffix (write fan-in, read fan-out) or move it into an in-process LRU on every node.' },
    ],
    diagram: `graph TB
    subgraph Clients
        App[Application Client]
        SDK[KV SDK]
    end
    subgraph Gateway
        LB[Load Balancer]
        Coord[Coordinator Node]
    end
    subgraph Services
        Ring[Consistent Hash Ring]
        N1[Node 1 Primary]
        N2[Node 2 Replica]
        N3[Node 3 Replica]
        ReadPath[Quorum Read R equals 2]
        WritePath[Quorum Write W equals 2]
        VC[Vector Clock Resolver]
        Gossip[Gossip Membership]
    end
    subgraph Async
        Hinted[Hinted Handoff Queue]
        AntiEntropy[Merkle Anti-Entropy Job]
        Compaction[SSTable Compaction]
        TTLSweeper[TTL Sweeper]
    end
    subgraph Storage
        MemTable[(MemTable In-Memory)]
        WAL[(Write-Ahead Log)]
        SSTable[(SSTables on Disk)]
        Bloom[(Bloom Filter Index)]
        HintStore[(Hint Store)]
        MetaDB[(Cluster Metadata)]
    end

    App --> SDK --> LB --> Coord
    Coord --> Ring
    Ring --> N1
    Ring --> N2
    Ring --> N3

    SDK -->|PUT key| Coord --> WritePath
    WritePath --> N1 --> WAL
    N1 --> MemTable
    MemTable --> SSTable
    SSTable --> Bloom
    WritePath --> N2
    WritePath --> N3

    SDK -->|GET key| Coord --> ReadPath
    ReadPath --> N1
    ReadPath --> N2
    ReadPath --> N3
    ReadPath --> VC

    SDK -->|DELETE key| Coord --> WritePath
    SDK -->|GET with TTL| Coord
    TTLSweeper --> SSTable

    N1 -.->|node down| Hinted --> HintStore
    HintStore --> N1
    AntiEntropy --> N1
    AntiEntropy --> N2
    AntiEntropy --> N3
    Compaction --> SSTable
    Gossip --> MetaDB
    Gossip --> Ring

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    class MemTable,WAL,SSTable,Bloom,HintStore,MetaDB storage
    class Hinted,AntiEntropy,Compaction,TTLSweeper async
    class LB edge`,
    tradeoffs: [
      { decision: 'LSM tree vs B-tree storage', rationale: 'LSM converts random writes into sequential writes via the MemTable + WAL, sustaining 10–100× higher write throughput than a B-tree at the cost of read amplification (multiple SSTables) and compaction CPU. B-trees give cleaner read paths and in-place updates, which matter more for read-mostly workloads with large values. Choose LSM when writes dominate (logs, time series, KV); choose B-tree when you need range scans over slowly-changing data with predictable latency.' },
      { decision: 'Quorum (Dynamo) vs single-leader (Raft) replication', rationale: 'Quorum-based replication keeps the cluster writeable through up to N−W failures with no leader election pause, but tolerates concurrent writes that must be reconciled with vector clocks or CRDTs. Single-leader Raft gives linearizable reads and writes for free but loses availability during the seconds-long election window after a leader crash. Pick quorum for availability-first KV (DynamoDB, Cassandra); pick Raft when correctness is non-negotiable (metadata stores, lock services).' },
      { decision: 'Vector clocks vs last-write-wins', rationale: 'Vector clocks faithfully detect concurrent writes and expose siblings to the application, preserving every update at the cost of complexity (the client now does the merge). LWW silently discards one side based on wall-clock timestamp, which is simpler but loses data on clock skew or true concurrency. Use vector clocks when data is additive (carts, counters); use LWW for caches and configurations where the latest update wins by definition.' },
      { decision: 'Leveled vs size-tiered compaction', rationale: 'Leveled compaction keeps reads cheap (each level has only one SSTable per key range) but writes the same data multiple times — write amplification can hit 10–30×. Size-tiered compaction batches similarly-sized SSTables, minimizing write amplification but ballooning read amplification and disk usage during compaction. Pick leveled for read-heavy workloads and SSDs; pick size-tiered for write-heavy ingestion and HDDs.' },
    ],
    keyTakeaways: ['Consistent hashing with virtual nodes is what makes online scale-up trivial — adding a node remaps ~1/N of keys with no global coordination', 'The quorum equation W+R>N is the single most important consistency knob; everything else is a refinement of how to handle the cases it does not cover', 'LSM trees trade higher write throughput for read amplification — Bloom filters and leveled compaction are the standard tools that keep reads fast despite that', 'Vector clocks plus read repair plus anti-entropy form a three-layer convergence strategy: synchronous detection at read time, asynchronous catch-up for misses, and periodic full reconciliation', 'Hinted handoff buys time during transient failures; gc_grace_seconds is the parameter that determines how long the cluster waits before assuming a node is permanently gone'],
    faqs: [
      { question: 'Why not just use Raft consensus across all keys instead of quorum replication?', answer: 'Raft requires a leader election whenever the leader fails, during which writes block — typically 1–5 seconds. With millions of key ranges, the probability that some leader is in election at any moment is high, so global write latency would jitter constantly. Raft also serializes all writes through the leader, capping single-range throughput.\nQuorum replication lets every replica accept writes in parallel and avoids any election pause; the cost is having to reconcile concurrent versions with vector clocks. For systems that prioritize availability over linearizability (shopping carts, session stores, user metadata), the Dynamo model wins.' },
      { question: 'How does the system avoid hot keys destroying a single node?', answer: 'Hot keys are detected by sampling the top-K most-accessed keys on each coordinator using a count-min sketch. When a key exceeds a threshold (say 10× the per-node average), the coordinator splits it: writes append to key:0, key:1, … key:M (M=16 typical), and reads fan out to all M shards and merge. For read-only hot keys like a celebrity profile, the coordinator instead caches the value in an in-process LRU on every node, eliminating the network hop entirely. Both techniques degrade gracefully under skew without operator intervention.' },
      { question: 'Is this really eventually consistent — what does that mean for the client?', answer: 'Eventually consistent means that if no new writes happen, all replicas will converge to the same value within bounded time (typically seconds, bounded by anti-entropy interval). It does not mean the client always sees old data: with W=R=2 on N=3 you read your own writes immediately. The pathological cases are concurrent writes from different clients (resolved via vector clocks or LWW) and reading right after a coordinator failover before hinted handoff completes. Clients that need stronger guarantees should use quorum reads or a session token (sticky coordinator) for read-your-writes semantics.' },
      { question: 'Why use virtual nodes instead of just N tokens per physical node?', answer: 'A single token per node means rebalancing is coarse: adding one node moves one big range, which creates a load spike on the donor. With 128–256 virtual nodes per physical node, the keyspace is finely sliced; adding a node shifts many small ranges from many donors in parallel, smoothing the bandwidth. Virtual nodes also make heterogeneity trivial — give a beefier node more virtual tokens to receive proportionally more load. The downside is that the metadata (token-to-node map) grows linearly with the number of virtual nodes; this is gossiped instead of stored centrally.' },
      { question: 'What happens if a node is down for longer than gc_grace_seconds?', answer: 'Once gc_grace_seconds elapses, compaction physically removes tombstones (deletion markers) from the live replicas. If the dead node then rejoins with an old, non-deleted version of a key, anti-entropy will see the live replicas no longer have any record of that key and the resurrected node will propagate the old value back — a deleted item appears to come back from the grave (the "zombie problem").\nThe operational rule is strict: nodes down longer than gc_grace_seconds must be wiped and re-bootstrapped from scratch via streaming, not rejoined. Some systems enforce this automatically by refusing membership for nodes whose last-seen exceeds the threshold.' },
      { question: 'How does this compare to Redis Cluster?', answer: 'Redis Cluster uses fixed 16,384 hash slots assigned to masters with replica masters, and is single-leader per slot with synchronous replication off by default — so failover can lose recent writes. It is optimized for in-memory speed and offers strong consistency only within a slot. A Dynamo-style store is disk-backed, supports tunable quorum, and survives multi-node failure without data loss, at the cost of higher per-operation latency (network quorum vs single-node memory access).\nUse Redis Cluster for sub-millisecond reads on data that can be regenerated; use a Dynamo-style store for durable, replicated state where availability under failure matters more than absolute latency.' },
      { question: 'Why an LSM tree instead of a hash index for an in-memory KV store?', answer: 'A hash index gives O(1) point lookups but cannot do range scans, has no ordering, and explodes in size for large keyspaces. An LSM tree keeps keys sorted, enabling range queries and prefix scans, while still serving point reads in ~1 disk seek with Bloom filters. For pure in-memory KV (Memcached), hashing wins. Once you need persistence, ordered iteration, or working sets larger than RAM, LSM is the default choice — which is why RocksDB underpins so many production KV stores.' },
      { question: 'How do you handle a network partition that splits the cluster in half?', answer: 'With N=3, W=2, R=2 quorum, only the side of the partition that holds at least 2 of the 3 replicas for a key can accept writes for that key. The minority side either rejects writes (CP behavior) or accepts them in sloppy quorum mode with hinted handoff (AP behavior, Dynamo default). When the partition heals, hinted handoff and anti-entropy reconcile divergence; conflicts surface as concurrent vector clocks for the application to resolve.\nThe tradeoff is fundamental: you cannot have linearizability and full availability during partitions (CAP theorem). The Dynamo model picks availability and gives the application the tools to deal with the consequences.' },
      { question: 'Why not use 2PC for cross-key transactions?', answer: 'A Dynamo-style KV store deliberately omits multi-key transactions: 2PC blocks writes during the prepare phase, and a single dead coordinator can lock keys indefinitely. The whole architectural premise is that no single component is allowed to gate writes. Applications that need multi-key atomicity layer it on top via patterns like sagas (compensating transactions) or move that data to a transactional DB. Modern systems like FoundationDB and Spanner combine the partitioning ideas with global transactions, but they pay for it with more coordination overhead and lower write throughput per node.' },
    ],
  },
  {
    id: 10,
    slug: 'design-google-drive',
    title: 'Design Google Drive / Dropbox',
    difficulty: 'Hard',
    category: 'Storage & Databases',
    tags: ['file-storage', 'sync', 'chunking', 'versioning', 'conflict'],
    problemStatement: `Design a cloud file storage and sync service like Google Drive. Users can upload/download files, sync across devices, share files, and view revision history. Target: 1B users, 15GB free storage each, fast sync.`,
    requirements: {
      functional: ['Upload and download files up to 5TB', 'Sync files across multiple devices in real-time', 'Share files/folders with permissions', 'File versioning and restore', 'Offline support'],
      nonFunctional: ['Sync latency < 2s for small files', '99.9% durability (11 nines for S3)', 'Efficient delta sync (only send changed bytes)', 'Global availability'],
    },
    capacityEstimates: `1B users × 15GB free = 15 exabytes total possible\nActual utilization ~10% = 1.5 EB\nS3 with cross-region replication for durability`,
    solutionBreakdown: [
      { section: 'API Surface', content: 'A small REST/gRPC surface backs the clients: POST /upload/init returns an upload_id and a list of chunk slots; PUT /upload/{upload_id}/chunk/{idx} streams a single chunk; POST /upload/{upload_id}/commit finalizes the file. Reads use GET /file/{file_id}?version=N which returns metadata plus signed CDN URLs per chunk. Sync clients also call POST /sync/cursor with the last known sync sequence and receive a delta stream of changes since that cursor.' },
      { section: 'Two-Tier Storage', content: 'Metadata lives in a sharded PostgreSQL cluster (files, folders, ACLs, chunk manifests, versions). Blob content lives in object storage (S3 with cross-region replication, or a custom blob store on top of HDFS for the largest tenants). Splitting them lets metadata writes hit ACID transactions while blob writes hit cheap, append-only storage that scales horizontally.' },
      { section: 'Content-Addressed Chunking', content: 'Files are split into 4MB chunks (configurable: 256KB for small frequent files, 16MB for cold archives). Each chunk is named by its SHA-256 — content-addressed storage means identical chunks across users, files, and versions deduplicate automatically.\nThe client computes hashes locally and sends only the hash list first; the server replies with which hashes it already has, and the client uploads only the missing ones. On a 10MB document with one paragraph edited, only the changed 4MB chunk actually traverses the wire.' },
      { section: 'Metadata Schema', content: 'Core tables: files(file_id, owner_id, parent_folder_id, name, current_version_id), versions(version_id, file_id, manifest_id, size, created_at, created_by), manifests(manifest_id, chunk_hashes[]), chunks(hash, ref_count, blob_url). Folder hierarchy is modeled with a parent_id foreign key plus a materialized path column for fast subtree queries. ACLs are stored as inherited entries: a permission on a folder propagates to children unless explicitly overridden.' },
      { section: 'Upload Flow', content: 'Client chunks and hashes the file locally, then calls /upload/init with the hash list. Server returns the subset it does not have plus pre-signed S3 PUT URLs. Client uploads chunks in parallel directly to S3 (no server bandwidth used). On all chunks uploaded, client calls /upload/commit which atomically inserts the new manifest, bumps the current_version_id, and increments ref_count on all chunks. Crashes mid-upload leave orphan chunks which are reaped after 24 hours.' },
      { section: 'Sync Engine', content: 'Each user has a monotonic sync_sequence counter. Every metadata mutation (file create/edit/delete/move) increments it and writes a row to a per-user sync_log table. Clients hold a long-lived sync connection (WebSocket with HTTP/2 fallback) and receive incremental log entries as they happen. On reconnect, the client sends its last known sequence and the server replays everything since — the client never asks "what changed?", it just consumes the log forward.' },
      { section: 'Conflict Detection & Resolution', content: 'Each file version carries a parent_version_id. When a client commits an edit, it must claim it was based on a known parent. If the current server version has already advanced past that parent (someone else edited while this client was offline), the server rejects the commit with HTTP 409. The client then creates a conflict copy: "Document (conflict copy from Alice 2024-01-15).docx" as a sibling, preserving both edits. Binary files are never auto-merged; for plain text and Google Docs, operational transformation or CRDTs can merge automatically.' },
      { section: 'Sharing & ACLs', content: 'Permissions are stored as (resource_id, principal_id, role) tuples with role in {viewer, commenter, editor, owner}. Folder permissions propagate to children via lazy inheritance: the access check walks up the parent chain stopping at the first explicit grant. Shared links use unguessable 128-bit tokens; access via link is a separate ACL entry with optional expiry. Permission checks are cached per (user, resource) for 30 seconds to avoid hot-path DB load.' },
      { section: 'Versioning & Retention', content: 'Every commit produces a new version row pointing at a manifest. Reverting copies the old manifest pointer into a new version (the old version is preserved). Storage cost is only the unique chunks across all versions — a 100MB file with 50 minor edits typically uses 100–120MB total. Retention policy: keep all versions for 30 days, then keep a logarithmic sample (daily for the past week, weekly for the past month, monthly forever) for paying users.' },
      { section: 'Delivery via CDN', content: 'Downloads issue signed URLs pointing at a CDN (CloudFront/Cloudflare) backed by S3. Hot chunks are cached at edge POPs near the user; cold chunks miss to S3. For large files, range requests let the client resume interrupted downloads. The CDN signs URLs with a short TTL (5 minutes) so revoking sharing access takes effect within minutes even for already-issued links.' },
      { section: 'Offline Support', content: 'The desktop and mobile clients maintain a local SQLite mirror of the metadata for files marked "available offline". Edits while offline are queued in a local mutation log keyed by an idempotency token. On reconnect, the client replays mutations in order, handling 409 conflict responses by creating local conflict copies. Files not marked offline are stub-only with lazy fetch on open.' },
      { section: 'Observability', content: 'SLIs: sync delivery latency (event commit to client receipt) P50/P99, upload completion rate, conflict rate per user, chunk dedup ratio (uploaded bytes / billed bytes). Alerts: sync log lag > 30 seconds for any user shard, S3 PUT error rate > 0.1%, chunk ref_count drift detected by reconciliation job, manifest write failure (would create orphans). Per-tenant dashboards expose storage usage trends and unusual sharing patterns (potential data exfiltration).' },
      { section: 'Scaling Levers', content: 'Metadata: shard by user_id since the access pattern is overwhelmingly per-owner; folders shared across many users use a fan-out cache. Blobs: S3 scales independently and is effectively unbounded for our volumes. Sync fanout: partition the WebSocket gateway by user_id so each user lives on one gateway node; use Redis pub/sub to fan events across nodes only for files shared across users on different gateways. Cold storage tiering: chunks not accessed for 90 days are moved to Glacier with a slower restore path.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Desktop[Desktop Sync Client]
        Mobile[Mobile App]
        WebUI[Web UI]
    end
    subgraph Edge
        CDN[CDN for Downloads]
        LB[Load Balancer]
    end
    subgraph Gateway
        APIGW[API Gateway]
        Auth[Auth Service]
    end
    subgraph Services
        UploadSvc[Chunk Upload Service]
        DownloadSvc[Download Service]
        MetaSvc[Metadata Service]
        SyncSvc[Sync and Notify Service]
        ShareSvc[Sharing and ACL Service]
        VersionSvc[Version History Service]
        ConflictSvc[Conflict Resolver]
        SearchSvc[Search Service]
    end
    subgraph Async
        DedupQ[Dedup Hash Lookup]
        ThumbGen[Thumbnail and Preview Gen]
        Indexer[Search Indexer]
        VirusScan[Antivirus Scanner]
        TrashGC[Trash Garbage Collector]
    end
    subgraph Storage
        ChunkStore[(Chunk Blob Store S3)]
        MetaDB[(Metadata DB PostgreSQL)]
        ChunkIndex[(Chunk Hash Index)]
        VersionDB[(Version History DB)]
        ACLDB[(Sharing ACL DB)]
        ES[(Elasticsearch)]
    end
    subgraph Analytics
        EventBus[Kafka Events]
        Lake[(Data Lake)]
    end

    Desktop -->|hash chunks then upload| APIGW
    Mobile -->|upload| APIGW
    APIGW --> Auth
    APIGW --> UploadSvc
    UploadSvc --> DedupQ --> ChunkIndex
    UploadSvc --> ChunkStore
    UploadSvc --> MetaSvc --> MetaDB
    MetaSvc --> VersionSvc --> VersionDB
    UploadSvc --> VirusScan
    UploadSvc --> ThumbGen --> ChunkStore

    WebUI -->|download| CDN --> DownloadSvc --> ChunkStore
    WebUI -->|view metadata| APIGW --> MetaSvc

    MetaSvc -->|change event| SyncSvc
    SyncSvc -->|websocket push| Desktop
    SyncSvc -->|websocket push| Mobile

    Desktop -->|conflicting edit| ConflictSvc --> VersionDB

    WebUI -->|share folder| APIGW --> ShareSvc --> ACLDB
    WebUI -->|search files| APIGW --> SearchSvc --> ES
    MetaSvc --> EventBus --> Indexer --> ES
    EventBus --> Lake

    MetaDB --> TrashGC --> ChunkStore

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class ChunkStore,MetaDB,ChunkIndex,VersionDB,ACLDB,ES storage
    class DedupQ,ThumbGen,Indexer,VirusScan,TrashGC async
    class CDN,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Block-level vs file-level deduplication', rationale: 'Block-level (chunk hashing) deduplicates across edits, across users, and across files — a small edit to a 1GB video reuploads only one 4MB chunk. File-level only catches identical files and is useless for everyday edits. Block-level is more complex (manifests, ref counts, garbage collection) but is the only viable choice at consumer scale where the dedup ratio routinely hits 30–60% for office documents.' },
      { decision: 'Fixed-size vs content-defined chunking', rationale: 'Fixed-size chunking (every 4MB) is simple and fast but fails on shifted content — prepend one byte and every chunk hash changes. Content-defined chunking (Rabin fingerprinting, FastCDC) sets boundaries on rolling-hash signatures, so an insertion only changes the local chunks. CDC dedups better but adds CPU cost and unpredictable chunk sizes. Use fixed-size for office docs (rare middle inserts); use CDC for VM images and database backups.' },
      { decision: 'Push (WebSocket) vs pull (long-poll) sync', rationale: 'Push notifies clients in under a second and avoids redundant polling, but holding 100M WebSocket connections requires a beefy gateway tier and graceful reconnection logic. Long-poll is simpler infrastructure but adds latency proportional to the poll interval and wastes bandwidth on quiet accounts. Most production designs use push for active sessions and fall back to a 30-second long-poll for mobile clients in background to save battery.' },
      { decision: 'Strong consistency vs eventual for sync', rationale: 'Strong consistency on the sync log (every client sees every event in order) makes conflict detection precise but bottlenecks on a single per-user log writer. Eventual delivery is cheaper but means client A may see B\'s edit before C does — conflict copies multiply. Per-user serialization (one writer per user shard) is the sweet spot: linear within a user, eventual across users, which matches the actual access pattern.' },
      { decision: 'Client-side vs server-side encryption', rationale: 'Server-side encryption (S3 SSE with KMS) lets the service serve previews, run virus scans, and search file content, but the operator can technically read user data. Client-side encryption (the client encrypts before upload with a key the server never sees) is zero-knowledge but breaks dedup across users (every user encrypts the same chunk to a different ciphertext) and disables server-side features. Most consumer services use SSE; zero-knowledge is reserved for niche providers like Tresorit and Proton Drive.' },
    ],
    keyTakeaways: ['Content-addressed chunking by SHA-256 is the single mechanism that delivers dedup, delta sync, and integrity verification — pick chunk size carefully because changing it later requires re-chunking the entire corpus', 'Splitting metadata (PostgreSQL) from blobs (S3) lets each tier scale on its own dimension; conflating them produces a monolith that hits a wall at petabyte scale', 'A monotonic per-user sync log is the right abstraction for cross-device sync — clients consume a log, they do not poll for diffs', 'Conflict copies beat automatic merge for binary files; for text, layer CRDTs or OT on top but accept the engineering cost', 'CDN-fronted blob delivery and lazy local mirrors are what make the system feel "instant" despite multi-region backends'],
    faqs: [
      { question: 'How do you handle a file that two users edit simultaneously while online?', answer: 'For a binary file (Word doc, PDF), the server uses parent_version_id concurrency control: the first save bumps the current version; the second save\'s parent_version_id is stale and the server returns 409. The client either retries on the new parent (if it can rebase) or creates a conflict copy. For Google Docs–style structured documents, the editor sits in front of an operational transformation (OT) or CRDT server that merges character-level edits in real time — the file is no longer the unit of change, the operations are. Most cloud storage products run both paths: structured editors for first-party formats, conflict copies for everything else.' },
      { question: 'How does the system prevent users from filling cheap storage with the same file?', answer: 'Content-addressed dedup means uploading the same chunk twice consumes one copy on disk, but each owner has a ref_count incremented. Quota is enforced on logical bytes (per-owner sum of file sizes) not physical bytes, so a user cannot share a popular meme and claim it cost no quota. The system internally still benefits from dedup (lower storage cost), but the user is billed for the size of the files they own. This is why dedup ratios above 30% are common on the backend even though every user "pays full price".' },
      { question: 'What happens if a chunk gets corrupted on disk?', answer: 'Every chunk\'s name is its SHA-256, so the server can verify on read by re-hashing and comparing. S3 cross-region replication keeps three copies in three AZs; a corrupt chunk is fetched from a sibling replica. A background scrubber walks the chunk store reading and verifying ~1% of chunks per day, repairing any that fail. The client also verifies hashes after download — if the server somehow returns wrong content, the client refuses to write it locally and re-requests.' },
      { question: 'Why store metadata in PostgreSQL instead of a NoSQL store?', answer: 'Metadata operations require multi-row atomicity: bumping current_version_id, inserting the new version row, incrementing chunk ref_counts, and writing the sync_log entry must succeed or fail together. PostgreSQL gives this for free with a transaction. A NoSQL store would force the app to implement 2PC or sagas, with the constant risk of orphaned chunks or duplicate sync events. Sharding PostgreSQL by user_id keeps each user\'s working set on one node, which is enough to scale to billions of users at the cost of cross-user queries being slow (acceptable — they are rare).' },
      { question: 'How do you handle a 5TB file upload that takes hours?', answer: 'Large uploads use resumable, chunked, parallel uploads: the client splits into 4MB chunks, uploads up to 50 in parallel directly to S3 via pre-signed URLs, and tracks completion in a local manifest. If the network drops, the client resumes by querying which chunks already exist server-side and uploading only the missing ones. The /upload/commit endpoint is idempotent — the client can retry it safely. Upload sessions hold an upload_id that survives 7 days, after which incomplete uploads are garbage-collected.' },
      { question: 'How do you serve a popular shared file to thousands of viewers without overloading the origin?', answer: 'The viewer client gets a signed CDN URL pointing at CloudFront/Cloudflare. The CDN edge caches each chunk on first hit; subsequent viewers in the same region hit the edge cache, never the S3 origin. Cache keys include the content hash so cache misses only happen on actual new content. For files that are mostly downloaded once (large backups), the CDN is bypassed and the client streams from S3 directly to avoid wasted edge cache.' },
      { question: 'How does sharing revocation propagate when the file is already cached at the CDN?', answer: 'Signed CDN URLs have a short TTL (5 minutes typical). Revoking access flips the ACL in PostgreSQL; from that moment, no new signed URLs are issued for the revoked principal. Already-issued URLs remain valid until their TTL expires. For high-sensitivity files, the system uses zero-TTL signing (the CDN calls a token-validation endpoint on every request), which trades performance for instant revocation.' },
      { question: 'Is dedup across users a privacy risk?', answer: 'Cross-user dedup leaks one bit of information: by uploading a file and observing whether the server requests the bytes, an attacker learns whether anyone else has that file. For sensitive contexts (legal, medical, IP), this can be a real leak. Mitigation: only dedup within a tenant (or never dedup), or only enable cross-user dedup after a "proof of possession" handshake where the client must prove it has the bytes before being granted a server copy. Most consumer services accept the leak; enterprise tiers offer per-tenant dedup as a setting.' },
      { question: 'How does the system garbage-collect chunks?', answer: 'Each chunk has a ref_count incremented on manifest insert and decremented when a manifest is deleted (version retention policy expires, file emptied from trash). When ref_count reaches zero, the chunk is queued for deletion. A delay of 7 days protects against race conditions where a new manifest claims a chunk being deleted. A periodic reconciliation job scans all manifests and recomputes ref_counts to catch drift from missed updates — drift is a sign of bugs in the commit path and pages on-call.' },
      { question: 'How do you handle a folder shared with 100,000 users?', answer: 'Lazy permission inheritance avoids exploding the ACL table: the folder has one row, and on each access check the system walks up the parent chain. The hot folder\'s membership list is cached in Redis as a Bloom filter so common "is user X a member" lookups are sub-millisecond. Sync fan-out is the harder problem: when a file in the shared folder changes, 100K sync_log entries must be inserted (one per user). The system writes a single fan-out event to a Kafka topic; a consumer fans it out asynchronously, with per-user backpressure and rate limits so a single shared folder cannot starve the sync pipeline.' },
    ],
  },
  {
    id: 11,
    slug: 'design-distributed-cache',
    title: 'Design a Distributed Cache',
    difficulty: 'Medium',
    category: 'Storage & Databases',
    tags: ['cache', 'redis', 'eviction', 'consistency', 'sharding'],
    problemStatement: `Design a distributed in-memory cache (like Memcached or Redis Cluster) that can serve millions of requests per second with sub-millisecond latency. The cache sits in front of a database and must handle node failures gracefully.`,
    requirements: {
      functional: ['GET/SET/DELETE operations', 'TTL support per key', 'Cache eviction (LRU)', 'Atomic operations (INCR, SETNX)', 'Support for different data types (strings, lists, sets, hashes)'],
      nonFunctional: ['< 1ms P99 latency', '1M+ ops/sec', 'Handle node failure without downtime', 'Consistent hashing for key distribution'],
    },
    capacityEstimates: `10 cache nodes × 128GB RAM = 1.28 TB cache\n1M ops/sec → 100K ops/sec per node\nNetwork: 1M × 1KB avg value = 1 GB/s aggregate`,
    solutionBreakdown: [
      { section: 'API Surface', content: 'A wire protocol on the order of RESP (Redis) or memcached binary: GET key, SET key value [EX seconds] [NX|XX], DEL key, INCR/DECR for atomic counters, MGET/MSET for batched ops, EXPIRE for TTL changes. The protocol supports pipelining (many requests over one connection without waiting for responses) which is the difference between 10K and 100K ops/sec from a single client. Higher-level data types (lists, sets, sorted sets, hashes) add commands like LPUSH, ZADD, HGETALL with O(1) or O(log N) complexity.' },
      { section: 'Data Layout in Memory', content: 'Each shard holds a hash table mapping key → slot, where a slot points to a small header (type, TTL expiry, last_access, ref count) and the value. Strings are stored inline up to ~44 bytes (embedded in the header), and as a separate allocation above that to avoid wasting cache lines. Hashes and sets use ziplist (a packed array) below a threshold and a hash table above it — saves 4× memory for small collections, which dominate real workloads.' },
      { section: 'Sharding via Consistent Hashing', content: 'The cluster topology is a 16,384-slot keyspace (Redis Cluster style) or a hash ring with 128 virtual tokens per node (Dynamo style). Clients compute CRC16(key) mod 16384 locally and connect directly to the owning shard — no proxy in the data path. The cluster gossips topology updates so client caches converge in seconds; on a MOVED reply (slot has migrated), the client refreshes and retries. Resharding migrates one slot at a time with reads served from both old and new shard during migration.' },
      { section: 'Replication & Failover', content: 'Each shard has one primary and 1–2 replicas. Writes go to the primary; the primary streams its write log to replicas asynchronously (or synchronously with WAIT). Replicas serve reads with bounded staleness (typically < 100ms behind). A separate quorum of sentinel/manager nodes monitors primary health and elects a replica to promote on failure — takedown to promotion takes 5–15 seconds. During the gap, writes fail fast and clients fall back to the underlying database.' },
      { section: 'Eviction Policies', content: 'When memory hits maxmemory, the cache evicts a victim. allkeys-lru samples 5–10 random keys and evicts the least-recently-used among them — approximating true LRU with O(1) cost. allkeys-lfu adds a probabilistic frequency counter (Morris counter) per key for "popular but not recent" workloads. volatile-* variants only evict keys with TTLs, protecting the persistent set. Production default is allkeys-lru with 8-key sampling — empirically close to perfect LRU at a fraction of the bookkeeping cost.' },
      { section: 'TTL & Expiration', content: 'Each key carries an absolute expiry timestamp. Two mechanisms remove expired keys: lazy expiration on access (every GET checks the timestamp first) and an active expirer that samples 20 random keys with TTLs every 100ms and removes any that are expired. The active scan adapts: if more than 25% of the sample is expired, it scans again immediately. This bounds the memory waste from expired-but-not-yet-deleted keys to ~25%.' },
      { section: 'Cache-Aside Pattern', content: 'The dominant integration pattern: application reads from cache; on miss it reads from the DB and writes back to cache with a TTL. On update, the application writes to the DB and either deletes (preferred) or updates the cache key. Deletion is safer than update because a concurrent reader-then-writer pair can race and leave a stale value in the cache; deletion forces the next read to repopulate from the now-current DB.' },
      { section: 'Thundering Herd & Stampede Control', content: 'When a hot key expires, every request misses simultaneously and stampedes the database. Three defenses, applied together in production: (1) randomized TTLs (jitter of ±10%) so expiries spread out; (2) single-flight locking — the first miss takes a distributed lock (SETNX) and populates; others wait on the lock or serve a stale value; (3) probabilistic early refresh — each read has a small probability of refreshing the key before expiry, proportional to how close the key is to expiring.' },
      { section: 'Connection Multiplexing', content: 'Servers handle 10K+ concurrent connections via single-threaded event loops (Redis) or thread-per-core architectures (KeyDB, Dragonfly). The single-threaded model avoids locks entirely — every command runs atomically — at the cost of capping throughput at one CPU core. Sharding overcomes this by spreading load across N cores via N processes. Clients use connection pools with pipelining to keep round-trip overhead low.' },
      { section: 'Persistence Options', content: 'Although the primary purpose is caching, some deployments need warm-restart capability. RDB snapshots fork a child every N minutes that walks memory and writes a compact binary dump. AOF (append-only file) logs every write command for replay. Cache-only deployments disable both for maximum throughput; cache-as-primary-store deployments enable AOF with fsync every second (bounding data loss to 1 second of writes).' },
      { section: 'Hot-Key Detection & Mitigation', content: 'A small number of keys often receive a disproportionate share of traffic (Zipfian distribution). The shard tracks the top-K hottest keys via a count-min sketch; when one exceeds a threshold (say 30% of shard QPS), it is either (a) replicated to all shards as a "global hot key" that the client can read from any shard, or (b) sharded by suffix (key:0, key:1, … key:N) for writes and read-fanned-out. A common cause is a celebrity profile; the read-only fanout to all shards reliably eliminates the hotspot.' },
      { section: 'Observability', content: 'Per-shard SLIs: ops/sec (split by command type), hit ratio, memory utilization, eviction rate, P99 GET latency. Cluster SLIs: client-perceived MOVED rate (indicates resharding storms), failover events, slot migration progress. Alerts: hit ratio drops > 5 percentage points (cache being thrashed, often a code change), memory > 80% with eviction rate climbing, sustained P99 latency above SLA. Per-key telemetry catches hot keys before they melt a shard.' },
      { section: 'Scaling Levers', content: 'Horizontal: add shards; consistent hashing migrates ~1/N of slots with online traffic. Vertical: bigger boxes with more RAM raise hit ratio without ops change, up to one CPU core per shard process. Multi-tier: a tiny in-process L1 in the app (5–10MB) catches the hottest 1% of keys with zero network cost, falling back to the distributed L2 cache. Read replicas spread read load when reads dominate. For write-heavy workloads, only sharding helps.' },
    ],
    diagram: `graph TB
    subgraph Clients
        AppA[App Server A]
        AppB[App Server B]
        Worker[Background Worker]
    end
    subgraph Gateway
        Proxy[Smart Client SDK]
        HashRing[Consistent Hash Router]
    end
    subgraph Services
        Shard1Primary[Shard 1 Primary]
        Shard1Replica[Shard 1 Replica]
        Shard2Primary[Shard 2 Primary]
        Shard2Replica[Shard 2 Replica]
        ShardN[Shard N Primary]
        Sentinel[Sentinel Failover Monitor]
        Mutex[Stampede Mutex Lock]
    end
    subgraph Async
        EvictLRU[LRU Eviction Task]
        Repl[Async Replication Stream]
        TTLExpire[TTL Expiration Sweep]
        WarmJob[Cache Warmer]
        RefreshAhead[Background Refresh]
    end
    subgraph Storage
        Mem1[(Shard 1 RAM)]
        Mem2[(Shard 2 RAM)]
        MemN[(Shard N RAM)]
        DB[(Origin Database)]
        AOF[(Append-only File)]
        Snapshot[(RDB Snapshot)]
    end

    AppA --> Proxy
    AppB --> Proxy
    Worker --> Proxy
    Proxy --> HashRing

    HashRing -->|GET key| Shard1Primary --> Mem1
    HashRing -->|SET key| Shard2Primary --> Mem2
    HashRing -->|INCR counter| ShardN --> MemN
    HashRing -->|SETNX lock| Shard1Primary

    Shard1Primary --> Repl --> Shard1Replica
    Shard2Primary --> Repl --> Shard2Replica
    Shard1Primary --> AOF
    Shard1Primary --> Snapshot

    AppA -->|read miss| Mutex
    Mutex -->|fetch origin| DB
    DB -->|populate| Shard1Primary
    AppA -->|write through| DB
    AppA -->|invalidate key| Shard1Primary

    Sentinel --> Shard1Primary
    Sentinel --> Shard2Primary
    Sentinel -->|promote| Shard1Replica
    EvictLRU --> Mem1
    EvictLRU --> Mem2
    TTLExpire --> Mem1
    WarmJob --> Shard1Primary
    RefreshAhead --> Shard2Primary

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    class Mem1,Mem2,MemN,DB,AOF,Snapshot storage
    class EvictLRU,Repl,TTLExpire,WarmJob,RefreshAhead async`,
    tradeoffs: [
      { decision: 'Cache-aside vs write-through vs write-behind', rationale: 'Cache-aside is the default — simple, only caches keys actually read, but every miss pays a DB round-trip. Write-through writes to cache and DB on every update, keeping the cache warm but wasting memory on rarely-read data and doubling write latency. Write-behind queues writes to the DB and acks the client immediately — fast but risks data loss if the cache crashes before the queue drains. Use cache-aside by default; write-through only when read latency on first miss is unacceptable; write-behind only with durable queueing and a clear acceptance of the data-loss window.' },
      { decision: 'Client-side vs proxy-based sharding', rationale: 'Client-side sharding (smart clients with topology cached) eliminates an extra hop and gives the lowest latency, but every language needs a fully-featured client and topology changes propagate slowly. Proxy-based (Envoy, twemproxy, ProxySQL) centralizes routing but adds one network hop and the proxy becomes a hotspot. Most production deployments start with smart clients and add a proxy only when polyglot or auth complexity makes maintaining N client libraries impractical.' },
      { decision: 'LRU vs LFU vs TTL-only eviction', rationale: 'LRU evicts on recency — great for working-set patterns (most workloads). LFU evicts on frequency — better when access patterns are stable and a small hot set should be sticky (CDN-style). TTL-only with no eviction protects the cache from filling up but requires every key to have a sensible TTL — operationally fragile. Default to allkeys-lru with 8-key sampling; switch to LFU only if metrics show LRU thrashing on stable hot sets.' },
      { decision: 'Async vs synchronous replication', rationale: 'Async replication keeps writes fast and replicas lag by milliseconds, but a primary crash before replication loses recent writes. Synchronous replication (WAIT command, or full quorum like Aerospike) blocks the write until replicas confirm — durable but adds 1–5ms latency per write. For caches, async is almost always correct: cached data is reconstructible from the DB, so a small loss window is acceptable. Reserve sync for sessions and tokens where losing a write breaks the user experience.' },
      { decision: 'Embedded L1 cache vs distributed cache only', rationale: 'An in-process L1 cache (Caffeine, Guava) eliminates network round-trips for the hottest 1% of keys, often 30× faster than a Redis round-trip. The cost is consistency — N application instances each have a private view, and invalidation requires a pub/sub fanout. Use L1 for read-mostly, eventually-consistent data (feature flags, product catalogs); avoid for anything where staleness causes bugs (user sessions, balances).' },
    ],
    keyTakeaways: ['Consistent hashing with virtual nodes is the foundation — it makes online scale-up and partial failures non-events instead of incidents', 'Approximate LRU (random-sample eviction) is the right default; true LRU costs too much bookkeeping for marginal benefit', 'Thundering herds are not a corner case but the dominant failure mode — single-flight locks plus TTL jitter plus probabilistic early refresh must all be in place', 'The cache-aside pattern with delete-on-write is safer than update-on-write because of read-modify-write races between application instances', 'Hot keys are the silent killer; instrument them with count-min sketches and have a documented playbook (replicate, shard by suffix, or move to L1) before they take down a shard'],
    faqs: [
      { question: 'Why is delete-on-write safer than update-on-write in cache-aside?', answer: 'Consider two app instances A and B. A reads the DB (gets value V1), B writes V2 to the DB then updates the cache to V2, then A writes V1 to the cache (overwriting V2). The cache is now stale with no eviction trigger. Delete-on-write avoids this: B simply removes the key, A\'s late write either succeeds with V1 (briefly stale until next reader repopulates from the now-current DB) or is dropped if A also followed delete-on-write. The race window collapses to a single read after the next miss.\nIn high-correctness systems, layer this with a version-tagged write (only set cache if the version equals the expected one) or use a transactional outbox to drive both DB and cache updates.' },
      { question: 'How does the cache handle a network partition between primary and replica?', answer: 'During a partition the primary keeps accepting writes; replicas fall behind. The sentinel/manager quorum (3 or 5 nodes across AZs) detects which side has the majority. If the primary is on the minority side, sentinels demote it and elect a new primary from the majority — split-brain is avoided because the old primary cannot reach quorum. The old primary refuses writes once it detects isolation, but writes accepted in the few seconds before detection are lost when it rejoins (the new primary\'s history wins). This is the durability price of async replication; AOF + sync replication eliminates it at the cost of latency.' },
      { question: 'Why is single-threaded faster than multi-threaded for in-memory caches?', answer: 'In-memory operations on a hash table take ~100ns each — the same order as a lock acquisition. A multi-threaded server pays for locks on every command, and lock contention dominates cost at high QPS. Single-threaded eliminates locks entirely: every command runs atomically and the bottleneck becomes CPU. Sharding across processes scales horizontally without ever needing locks. KeyDB and Dragonfly do achieve multi-threaded performance by partitioning the keyspace internally and pinning each shard to a core — essentially running N single-threaded servers in one process.' },
      { question: 'How do you migrate a shard from one node to another without downtime?', answer: 'Slot migration in Redis Cluster works in three phases. Start: source marks the slot as MIGRATING; destination marks it as IMPORTING. Stream: source iterates keys in the slot and copies each to the destination via a MIGRATE command which is atomic per key. During this phase, reads still go to the source (with a fallback redirect for already-migrated keys); writes go to wherever the key currently lives. Finish: when the slot is empty, source clears MIGRATING, destination clears IMPORTING and announces ownership via gossip. Clients receive MOVED responses and update their topology cache. The whole process is online with millisecond-scale per-key impact.' },
      { question: 'How do you size the cache — what hit ratio is "good enough"?', answer: 'For a database-fronting cache, target 90–95% hit ratio at peak. Below 80% the cache is mostly overhead — the DB is still doing most of the work, and adding RAM is cheaper than adding DB capacity. Above 98% you may be overprovisioning; check whether the working set has stopped growing or you simply have plenty of headroom. Working-set size from access logs is the principled answer: count distinct keys touched in the past hour and multiply by average key+value size, then add 30% headroom. Most teams arrive at the right size iteratively: start with 2× the active dataset, then watch eviction rate and adjust.' },
      { question: 'Can I use the cache as my primary database?', answer: 'Yes for narrow use cases — session stores, leaderboards, real-time counters — where you enable persistence (AOF + RDB), use synchronous replication with WAIT, and accept that recovery from a full cluster outage requires loading the dump (minutes for tens of GB). The downsides versus a real database are limited query capabilities (no joins, no transactions across keys), expensive RAM-per-byte cost, and the operational baggage of treating a cache like a system of record. Production-grade examples exist (Twitter\'s timeline serving on Redis), but they typically pair the cache with a durable system for backups and DR.' },
      { question: 'How do you handle a key that is too big to cache (e.g., a 100MB user profile)?', answer: 'Large values hurt: they crowd out smaller hot keys, slow MGET pipelines (one slow response blocks the whole pipeline), and bloat replication bandwidth. Two fixes. Split into smaller keys: user:123:profile → user:123:basics + user:123:preferences + user:123:history, fetched as a single HMGET. Or store only a pointer in the cache and the full payload in object storage with a CDN; the cache short-circuits the pointer lookup and the CDN handles bandwidth. Most caches enforce a max value size (1MB default in many configs) — exceeding it should be a code review smell.' },
      { question: 'What\'s the right TTL for a cache key?', answer: 'TTL should approximate "how long until the underlying data could change in a way the user would notice." Configuration data: hours to days, with active invalidation on change. Product listings: 5–15 minutes. User session data: as long as the session, often hours. Real-time counters: never expire (let LRU evict). Negative caches (recording that something doesn\'t exist): short — 30–60 seconds — so creation is noticed quickly. Always add ±10% random jitter to spread expiries; without jitter, a cohort of keys populated at the same time will all expire at the same time and stampede.' },
      { question: 'When does this design break down?', answer: 'Three common failure modes. (1) Very large values + high QPS: a 1MB value at 10K QPS is 10 GB/s of network — saturates 100GbE before CPU cares; mitigation is value compression and L1 caches. (2) Pathological hot keys (a celebrity profile getting 90% of traffic for one shard): single-threaded server is CPU-pinned; needs hot-key fanout. (3) Working set larger than RAM by a wide margin: eviction churn destroys hit ratio, every read is a DB call, the cache becomes overhead; the answer is "buy more RAM" or "redesign access patterns" — distributed caches genuinely cannot help here.' },
    ],
  },
  {
    id: 12,
    slug: 'design-distributed-database',
    title: 'Design a Distributed SQL Database',
    difficulty: 'Hard',
    category: 'Storage & Databases',
    tags: ['sql', 'sharding', 'replication', 'raft', 'transactions'],
    problemStatement: `Design a distributed relational database that supports SQL, ACID transactions, horizontal sharding, and automatic failover. Think CockroachDB or Google Spanner.`,
    requirements: {
      functional: ['Full SQL support', 'ACID transactions across shards', 'Automatic sharding and rebalancing', 'Geo-distributed replication', 'Online schema changes'],
      nonFunctional: ['< 10ms single-region reads', '< 100ms cross-region transactions', '99.999% availability', 'Linear scalability with node count'],
    },
    capacityEstimates: `100 nodes × 2TB SSD = 200TB storage\n3× replication = 600TB total\n100K transactions/sec distributed across cluster`,
    solutionBreakdown: [
      { section: 'Architectural Layers', content: 'Three distinct layers serve different concerns. The SQL layer parses SQL, plans queries, manages connections, and exposes Postgres or MySQL wire protocol. The transaction layer enforces ACID semantics across ranges via 2PC over Raft groups. The storage layer is a transactional key-value store (RocksDB on each node) with ranges as the unit of replication. Each layer scales independently — the SQL gateway can scale horizontally while ranges rebalance underneath.' },
      { section: 'Range-Based Sharding', content: 'Data is sliced into ranges (typically 64–512MB) of contiguous key space. Tables and indexes are encoded into the keyspace such that primary keys are stored sorted — a range for "users with id 1000–2000" is one physical range. A meta layer (Bigtable METADATA table or CockroachDB system ranges) maps key prefixes to range descriptors. Clients cache the meta and resolve any key to its range in microseconds; stale meta triggers a NotLeaseHolderError and a refresh.' },
      { section: 'Raft Replication per Range', content: 'Each range is a Raft group of 3 (sometimes 5) replicas on different nodes, ideally in different failure domains. Writes go to the Raft leader, which appends to its log, replicates to followers, and commits once a majority acknowledges. A leader failure triggers an election in 100–1000ms (election timeout randomized to avoid split votes). Per-range Raft means there is no single hot leader for the whole cluster — leaders are spread across nodes proportional to traffic.' },
      { section: 'Lease-Based Reads', content: 'A range leader holds a lease (typically 9 seconds) granting it the right to serve reads locally without consulting followers. Reads at the leader skip the Raft round-trip — they are O(local disk seek) instead of O(network quorum). When a leader\'s lease expires or it crashes, another replica acquires a new lease via a single Raft round; reads briefly stall during the transition. Lease coordination prevents the "two leaders both serving reads" anomaly during network partitions.' },
      { section: 'Distributed Transactions (2PC over Raft)', content: 'A transaction touching ranges R1, R2, R3 uses Raft-replicated 2PC. The coordinator (chosen as the leader of the transaction record) writes intents (provisional values with a transaction ID) on each range. After all intents land, the coordinator commits by atomically flipping the transaction record from PENDING to COMMITTED — a single Raft write. Readers that encounter intents look up the transaction record to know whether to honor or skip the intent. Coordinator failure is not fatal because the record itself is Raft-replicated; another node can finish the protocol.' },
      { section: 'Time: TrueTime vs HLC', content: 'Spanner uses TrueTime: GPS + atomic clocks in every datacenter give bounded clock uncertainty (typically 7ms). Read-write transactions wait out the uncertainty interval at commit, guaranteeing externally-consistent timestamps. CockroachDB uses Hybrid Logical Clocks (HLC) — wall clock plus a logical counter that advances on every message receipt. HLC bounds skew between communicating nodes but cannot guarantee external consistency for unrelated transactions. Both prevent stale reads via uncertainty intervals; TrueTime gives stronger guarantees at the cost of specialized hardware.' },
      { section: 'Concurrency Control', content: 'Optimistic MVCC: every key stores a chain of versioned values keyed by transaction timestamp. Reads see the latest version with timestamp ≤ their snapshot — non-blocking. Writes leave intents; another transaction reading an intent in its own future enters a wait-for graph. Conflicts are detected at commit time, and the higher-priority transaction wins (the other restarts). Pessimistic locking is available via SELECT FOR UPDATE for hot-row workloads (inventory deduction, bank balance) where retry churn dominates.' },
      { section: 'Cross-Region Replication', content: 'Replicas can be placed across geographic regions for disaster recovery and locality. Two common topologies: leader-in-one-region (all writes hit the primary region; readers in other regions tolerate higher latency or read from followers) and follower-reads-anywhere (any region can serve consistent reads at a slight staleness). Geo-partitioning pins specific rows to specific regions — a row for an EU customer has all three replicas in EU datacenters, both for latency and for GDPR data residency.' },
      { section: 'Online Schema Changes', content: 'Schema changes (ADD COLUMN, ADD INDEX) run online via a multi-stage state machine: the new schema is written but invisible; old and new schemas coexist as readable; a backfill job populates the new index/column; finally the old schema is dropped. Each stage commits via a Raft write to the system ranges so all nodes pick up the new state. Long-running backfills (terabyte tables) checkpoint progress so failures resume rather than restart.' },
      { section: 'Rebalancing & Repair', content: 'The cluster monitors per-range traffic and storage; an overloaded range is split when it exceeds size or QPS thresholds, and the resulting two ranges are migrated to less-loaded nodes. Migration uses Raft snapshotting — the destination becomes a learner replica catching up, then replaces the source. Lost replicas (node failure or disk loss) are recreated automatically: the surviving Raft group adds a new replica on a healthy node, with the new replica streaming the full range as a snapshot.' },
      { section: 'Failure Modes', content: 'Single-node failure: ranges with replicas on that node lose a follower; new replicas are placed within minutes; reads/writes continue uninterrupted. Quorum loss (2 of 3 replicas dead): the range becomes unavailable until manual intervention or replica recovery; this is rare with proper rack/AZ distribution. Network partition: each side runs a leader election; only the side with quorum can commit. Disk corruption: checksums catch it at read time; the corrupted replica is removed and replaced.' },
      { section: 'Observability', content: 'Per-range metrics: leader location, Raft log replication lag, lease holder churn rate, intent count, read/write QPS. Cluster SLIs: P99 transaction latency split by transaction size, range count, range split rate (high values indicate hot-spotting), under-replicated range count. Alerts: ranges under-replicated for > 5 minutes (data durability at risk), Raft commit latency > 100ms (network or disk issues), transaction abort rate > 5% (contention or skew).' },
      { section: 'Scaling Levers', content: 'Add nodes to grow capacity — rebalancing moves ranges to the new nodes online. Split hot ranges manually if a table has a monotonically increasing primary key (sequential inserts hit one range; remedy is to hash-prefix the key). Place leaders close to the dominant traffic for read latency. For analytical queries that scan terabytes, route them to follower replicas to spare leaders. For multi-region writes, partition by user region (geo-partitioning) so most transactions stay within a single region.' },
    ],
    diagram: `graph TB
    subgraph Clients
        AppClient[App Client]
        SQLDriver[SQL Driver]
        AnalyticsClient[Analytics Client]
    end
    subgraph Gateway
        LB[Load Balancer]
        SQLLayer[SQL Parser and Optimizer]
        Planner[Distributed Plan Executor]
    end
    subgraph Services
        TxCoord[Transaction Coordinator]
        TwoPC[Two Phase Commit Manager]
        HLC[Hybrid Logical Clock]
        MetaLayer[Range Metadata Service]
        Range1Leader[Range 1 Raft Leader]
        Range2Leader[Range 2 Raft Leader]
        Range3Leader[Range 3 Raft Leader]
        Range1F1[Range 1 Follower]
        Range1F2[Range 1 Follower]
        Range2F1[Range 2 Follower]
        Range3F1[Range 3 Follower]
        SchemaSvc[Online Schema Change]
    end
    subgraph Async
        Rebalancer[Range Rebalancer]
        Splitter[Range Splitter 64MB]
        Backup[Incremental Backup Job]
        GC[MVCC Garbage Collector]
        ReplLag[Replica Catch-up Worker]
    end
    subgraph Storage
        RaftLog[(Raft Log)]
        RocksDB[(RocksDB Range Store)]
        MetaDB[(Range Metadata Table)]
        BackupBlob[(Backup Object Store)]
        CDCStream[(CDC Change Stream)]
    end
    subgraph Analytics
        EventBus[Kafka CDC Bus]
        Warehouse[(Analytics Warehouse)]
    end

    AppClient --> SQLDriver --> LB --> SQLLayer
    AnalyticsClient --> LB
    SQLLayer --> Planner
    Planner --> MetaLayer --> MetaDB

    Planner -->|single range read| Range1Leader
    Planner -->|distributed join| Range2Leader
    Planner -->|distributed join| Range3Leader

    SQLDriver -->|BEGIN TXN| TxCoord
    TxCoord --> HLC
    TxCoord --> TwoPC
    TwoPC -->|prepare| Range1Leader
    TwoPC -->|prepare| Range2Leader
    TwoPC -->|commit| Range1Leader
    TwoPC -->|commit| Range2Leader

    Range1Leader --> RaftLog
    Range1Leader --> RocksDB
    Range1Leader --> Range1F1
    Range1Leader --> Range1F2
    Range2Leader --> Range2F1
    Range3Leader --> Range3F1

    SQLDriver -->|ALTER TABLE| SchemaSvc --> MetaLayer

    Splitter --> Range1Leader
    Rebalancer --> Range2Leader
    GC --> RocksDB
    ReplLag --> Range1F1
    Backup --> BackupBlob

    Range1Leader --> CDCStream --> EventBus --> Warehouse

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class RaftLog,RocksDB,MetaDB,BackupBlob,CDCStream storage
    class Rebalancer,Splitter,Backup,GC,ReplLag async
    class LB edge
    class EventBus,Warehouse analytics`,
    tradeoffs: [
      { decision: 'Range-based vs hash-based sharding', rationale: 'Range-based keeps related rows physically close, making range scans and primary-key joins cheap, but creates hotspots on monotonically increasing keys (every insert lands on the last range). Hash-based scatters writes uniformly but kills range scans — a "users in EU" query becomes a full cluster fan-out. Spanner and CockroachDB use range; most NoSQL stores (DynamoDB, Cassandra) use hash. Range is correct for SQL; pair it with hash-prefixed primary keys for sequential-insert tables.' },
      { decision: 'Raft vs Paxos', rationale: 'Raft is structurally simpler (strong leader, append-only log) and the canonical reference implementation is widely battle-tested. Multi-Paxos is more flexible (allows leaderless operation) but harder to get correct — most teams that pick Paxos end up reimplementing Raft\'s simplifications. Pick Raft unless you have a specific reason (e.g., Spanner uses a Paxos variant for its multi-decree pipelining).' },
      { decision: 'TrueTime vs HLC', rationale: 'TrueTime (GPS + atomic clocks) gives bounded clock uncertainty and externally consistent transactions out of the box but requires special hardware in every datacenter — feasible for Google, not for most operators. HLC achieves the same internal ordering for transactions that communicate but cannot guarantee external consistency for independent transactions. Pick HLC for self-hosted; the correctness gap is small and rarely observable.' },
      { decision: 'Optimistic vs pessimistic concurrency', rationale: 'Optimistic MVCC is non-blocking for reads and scales beautifully when conflicts are rare — the dominant case in OLTP. Under high contention (everyone updating inventory:item:123), the abort-retry storm wastes work and tail latency spikes. Pessimistic locks via SELECT FOR UPDATE serialize cleanly but block readers and create lock-graph deadlocks. Use optimistic by default; selectively switch hot rows to pessimistic.' },
      { decision: 'Async cross-region replication vs synchronous quorum', rationale: 'Async cross-region keeps writes fast (commit at the local region, replicate to others in the background) but loses recent data on regional failure. Synchronous (Raft quorum spans regions) gives zero data loss but every write pays cross-region latency — 100ms+ across continents. Pick by use case: customer balances synchronous, analytics logs async, with explicit RPO targets per dataset.' },
    ],
    keyTakeaways: ['Per-range Raft groups spread leadership across the cluster — there is no single hot node, and any range can fail over independently', 'Range-based sharding is what makes SQL semantics work distributed; you keep ORDER BY, range scans, and joins on the partitioning key', '2PC layered on top of Raft turns "if the coordinator dies the transaction is stuck" into "the coordinator state is replicated, anyone can finish the protocol"', 'MVCC plus snapshot reads gives unlimited read concurrency without blocking writers — the single biggest contributor to throughput in modern OLTP', 'TrueTime / HLC is the unsung hero — without bounded clock uncertainty you cannot prove cross-region serializability and have to fall back to slower coordination'],
    faqs: [
      { question: 'Why per-range Raft instead of one Raft group for the whole cluster?', answer: 'A single Raft group serializes every write through one leader — at scale that leader is the bottleneck, both in CPU and network bandwidth. Per-range Raft means a 1000-range cluster has 1000 Raft groups with 1000 leaders, spread across all nodes. Aggregate write throughput grows linearly with range count. The cost is meta complexity: clients must resolve which range owns a key and which node is the leader. CockroachDB and Spanner both pay that cost gladly.\nThe other path is leaderless quorum replication (Dynamo-style), but that loses linearizability and makes SQL transactions hard to express.' },
      { question: 'How does 2PC avoid the classic "coordinator dies, transaction stuck" problem?', answer: 'The transaction record itself is stored as a Raft-replicated row on some range — usually the range containing the first write. When the coordinator (the gateway node) crashes mid-2PC, any node that encounters an intent left by the dead transaction looks up the transaction record. If the record says COMMITTED, the intent is materialized. If it says ABORTED, the intent is cleaned up. If it says PENDING and the coordinator heartbeat is stale, the reader can abort the transaction itself by Raft-writing ABORTED to the record. The protocol always terminates because the record is durable and any participant can drive it forward.' },
      { question: 'Why are reads so fast in this design?', answer: 'Two mechanisms. (1) Lease-based reads: the range leader holds a lease and answers reads from its own state without any Raft round-trip — one local SSD seek. (2) Snapshot reads via MVCC: each transaction picks a timestamp and reads the version chain as of that timestamp; no locks, no blocking on concurrent writers. Combined, an indexed lookup is ~1ms (network + disk) regardless of write QPS. Followers can also serve reads at a slight staleness (closed timestamp protocol), spreading read load further.' },
      { question: 'What happens during a network partition?', answer: 'Each Raft group on each side of the partition runs an election. Only the side with a majority of replicas (2 of 3, or 3 of 5) can elect a leader and commit writes — the minority side blocks. There is no split-brain because both sides need majority and you cannot have two majorities. Reads on the minority side fail (no lease holder). When the partition heals, the minority side rejoins by receiving the missing Raft log entries from the new leader. Lost writes are only those that were not yet replicated to a majority when the partition began — bounded by the few-millisecond window between client receipt and quorum acknowledgment.' },
      { question: 'How is this different from MySQL with sharding via Vitess?', answer: 'Vitess shards MySQL horizontally and adds a query router, but each shard is still a standalone MySQL with primary-replica replication. Cross-shard transactions in Vitess are best-effort via 2PC and have a smaller surface than native distributed transactions. A native distributed SQL DB integrates 2PC, MVCC, and consensus into the storage layer — every write is replicated via Raft, every transaction has snapshot isolation by default, and cross-shard joins are first-class. Vitess wins on operational maturity (you know MySQL); native distributed wins on correctness and horizontal write scalability.' },
      { question: 'What\'s the latency cost of cross-region transactions?', answer: 'A transaction that writes to a range whose Raft group spans US-East, US-West, and EU-West pays at minimum one round-trip to the second-closest replica (the majority quorum). For US-East-leader writes, US-West acknowledges in ~70ms; EU adds nothing because the quorum is already met. Cross-region single-shot writes are thus 70–150ms. Multi-statement transactions multiply by the number of statements unless batched.\nTo cut this, geo-partition: pin EU customer data to ranges with all replicas in EU, so an EU customer\'s transactions stay local at 1–5ms. Cross-region is only paid for global metadata or rare cross-customer queries.' },
      { question: 'How do you handle a monotonically increasing primary key (e.g., AUTOINCREMENT)?', answer: 'A sequential primary key forces every insert into the latest range, creating a write hotspot. Three solutions. (1) Hash-prefix the key — store CRC16(id) || id so inserts scatter across ranges (loses ordered scans on the hash-prefixed column). (2) Use a UUID v4 as the primary key — random by design, scatters inserts naturally. (3) Pre-split the future range: tell the system to create N splits ahead so the inserts hash into existing ranges. CockroachDB and Spanner both default to UUIDs in their tutorials for this reason; AUTOINCREMENT is a relational habit that does not survive horizontal scaling.' },
      { question: 'Can I run a cluster across cloud regions and on-prem?', answer: 'Technically yes — Raft does not care where the nodes live as long as they can talk. Practically, the latency profile becomes inconsistent: on-prem to cloud may be 30ms one direction and 80ms the other (different ISP paths), which destabilizes lease elections and transaction commits. You also pick up egress costs (cloud-to-on-prem traffic is metered). Most production deployments stay within a single cloud or a single multi-region cloud (AWS regions). Hybrid is reserved for migration windows, not steady state.' },
      { question: 'Why is this slower for single-key writes than a single-node Postgres?', answer: 'A single-key write here pays for Raft replication: the leader writes locally, sends to two followers, waits for one to ack, then commits. That is ~1ms in a well-tuned single-DC cluster — versus ~100µs for a single-node Postgres write. The benefit is that you keep this latency even as the cluster grows to 100 nodes and survives any single-node failure with zero data loss. For applications where 1ms vs 100µs matters (HFT), a distributed SQL DB is the wrong choice. For everything else, the durability and scalability are worth the order-of-magnitude cost.' },
      { question: 'How are schema changes online but still safe?', answer: 'Schema changes use the F1 / Spanner protocol: every node must reach a "compatible" version before the next state is applied, gated by a Raft-written schema version. ADD COLUMN proceeds through: column added but invisible, column readable, column writable, column required. Each transition waits until all leases on the old version expire. ADD INDEX adds the index in a backfill phase: data is read, indexed, and written in chunks with checkpoints; concurrent writes update both the table and the (partial) index via a write-twice scheme. The whole process is throttled to avoid impacting OLTP traffic; on a billion-row table it can take hours but never blocks reads or writes.' },
    ],
  },
  {
    id: 13,
    slug: 'design-notification-system',
    title: 'Design a Notification System',
    difficulty: 'Medium',
    category: 'Messaging & Streaming',
    tags: ['push-notifications', 'email', 'sms', 'queue', 'fanout'],
    problemStatement: `Design a notification system that sends push notifications, emails, and SMS to users based on events. Target: 10M notifications/day across channels, reliable delivery, user preference management.`,
    requirements: {
      functional: ['Send push, email, SMS notifications', 'User opt-in/out per channel and type', 'Notification templates', 'Delivery receipts and retry on failure', 'Rate limit notifications per user'],
      nonFunctional: ['< 5s delivery for push', '99.9% delivery rate', '10M notifications/day', 'Idempotent delivery (no duplicates)'],
    },
    capacityEstimates: `10M/day ≈ 116/sec average, burst up to 10K/sec\nPush: 60% → 6M/day via APNs/FCM\nEmail: 30% → 3M/day via SendGrid/SES\nSMS: 10% → 1M/day via Twilio`,
    solutionBreakdown: [
      { section: 'API Surface', content: 'Producer services call POST /notifications with a payload: { user_id, template_id, variables: {…}, channel_hint, priority, idempotency_key }. The service responds 202 Accepted with a notification_id once the request is durably queued. A separate GET /notifications/{id} returns delivery status and a list of attempts per channel. Webhooks POST delivery receipts back to the producer when the notification is sent/opened/clicked.' },
      { section: 'Event Ingestion', content: 'Two ingress paths: (1) direct API calls from microservices that want to send specific notifications (transactional emails), and (2) Kafka topics for domain events ("user.purchase", "friend.request") that the notification service translates into notifications. The Kafka path decouples producers — they emit a single event regardless of how many notifications it should produce. The notification service consumes the event, fans it out to subscribed channels, and writes outbound jobs.' },
      { section: 'Data Model', content: 'Core tables: notifications(id, user_id, template_id, payload, idempotency_key, created_at), attempts(notification_id, channel, provider, status, attempted_at, error_code), preferences(user_id, channel, category, opted_in), templates(id, name, channel, locale, body, variables[]), suppressions(user_id, category, reason, suppressed_until). Suppressions exist for unsubscribes, bounces, and rate-limit holds — they are checked before every send.' },
      { section: 'Channel Workers', content: 'A worker pool per channel (push, email, SMS, in-app) consumes from a channel-specific queue (Kafka topic or SQS). Each worker: fetches the user\'s device tokens / email / phone, renders the template with the payload variables, calls the provider API (FCM/APNs for push, SES/SendGrid for email, Twilio for SMS), records the attempt, and emits a delivery event. Per-channel isolation means a provider outage in one channel (Twilio degraded) does not back up notifications in others.' },
      { section: 'Templating & Localization', content: 'Templates are stored per (template_id, locale) with handlebars-style variable interpolation: "Hi {{first_name}}, your order #{{order_id}} has shipped." Localization falls back: pt-BR → pt → en. Templates are versioned; a deploy publishes a new version and a feature flag picks one. Plain-text and HTML versions are stored together for emails; AMP variants for interactive emails. Marketing templates require approval workflow before going live.' },
      { section: 'User Preferences & Subscriptions', content: 'Preferences are a (user, channel, category) matrix. Categories: transactional (always-on, no opt-out), product_updates, marketing, social, recommendations. Channels: push, email, SMS, in-app. A "send" requires the user to have opted-in for the (channel, category) and not be on the suppression list. Unsubscribes propagate immediately via a Redis cache fronting the preferences DB so a click-to-unsubscribe is honored on the next attempt within seconds.' },
      { section: 'Idempotency', content: 'Producers supply an idempotency_key per notification (often the source event ID). The notification service stores (user_id, idempotency_key) → notification_id with a 24-hour TTL. A duplicate request with the same key returns the original notification_id without creating a new send. This is essential because Kafka delivers at-least-once and producer retries are common — without idempotency, a single password-reset email becomes three.' },
      { section: 'Retry & Backoff', content: 'On provider error, classify: transient (5xx, rate limited, network timeout) → retry; permanent (invalid token, bounced) → suppress and emit a "permanent_failure" event for the application to react. Retry schedule: exponential backoff 30s, 2m, 8m, 30m with ±25% jitter. After max attempts (usually 5), move to a dead-letter queue. SMS is special — providers charge per attempt, so retry budgets are tighter.' },
      { section: 'Rate Limiting & Throttling', content: 'Multiple layers. Per-user: max N notifications per channel per hour (configurable per category; 50 push, 5 marketing emails per week). Per-tenant: protect downstream providers from a bug-induced flood — token bucket per producer service. Global per-provider: respect provider quotas (SES daily quota, Twilio per-second cap) using a Redis counter shared by all workers. Excess marketing notifications are dropped; excess transactional notifications wait in the queue.' },
      { section: 'Provider Failover', content: 'Each channel has multiple providers. Email: SES primary, SendGrid secondary. SMS: Twilio primary, MessageBird secondary. The router picks based on per-provider health scores (success rate, latency), region (use the cheapest provider that serves the user\'s region well), and cost. On primary provider failure, automatic failover after 3 consecutive errors. A canary fleet of 1% of traffic always exercises the secondary so it does not bit-rot.' },
      { section: 'Quiet Hours & Time-Zone Awareness', content: 'A 3am marketing push to a user in their local time is unforgivable. Each notification carries the user\'s timezone (stored on the user profile). Marketing and recommendations are held in a scheduled queue if delivery time falls outside the user\'s 9am-9pm window — they release at 9am local. Transactional notifications (password reset, fraud alert) override quiet hours. A separate per-tenant policy lets B2B customers configure stricter hours.' },
      { section: 'Observability', content: 'SLIs: end-to-end notification latency (event ingested to provider acknowledged), delivery success rate by channel and provider, bounce/unsubscribe rate, provider error rate, queue depth per channel. Alerts: success rate drops > 2 percentage points for any channel-provider pair, queue depth growing for 5+ minutes (consumers can\'t keep up), bounce rate spike (often a template bug or list rot), suspicious flood from one producer (> 10× baseline). Per-tenant dashboards expose engagement metrics: open rate, click rate, conversion.' },
      { section: 'Scaling Levers', content: 'Horizontal worker scaling on queue depth — autoscale push workers when push queue > 1000. Partition queues by user_id hash to keep per-user ordering and enable parallel processing. Cache template renders and user preferences in Redis to avoid hitting the DB on every send. For the largest tenants (millions of recipients per campaign), introduce a "campaign fanout" job that batches and pre-computes per-recipient payloads to amortize template rendering.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Mobile[Mobile App]
        Web[Web App]
        EmailInbox[Email Inbox]
        Phone[SMS Phone]
    end
    subgraph Edge
        APNs[APNs and FCM Gateway]
    end
    subgraph Gateway
        APIGW[Notification API]
        Auth[Auth Service]
    end
    subgraph Services
        EventConsumer[Event Consumer]
        NotifRouter[Notification Router]
        PrefSvc[Preference Service]
        TemplateSvc[Template Renderer]
        RateLimiter[Per User Rate Limiter]
        Dedup[Idempotency Dedup]
        ReceiptSvc[Delivery Receipt Service]
        PrioritySvc[Priority Queue Service]
    end
    subgraph Async
        Kafka[Kafka Event Topics]
        PushQ[Push Queue]
        EmailQ[Email Queue]
        SMSQ[SMS Queue]
        PushWorker[Push Worker Pool]
        EmailWorker[Email Worker Pool]
        SMSWorker[SMS Worker Pool]
        RetryQ[Retry Queue Exp Backoff]
        DLQ[Dead Letter Queue]
    end
    subgraph Services2 [Providers]
        FCM[FCM and APNs]
        SES[AWS SES SendGrid]
        Twilio[Twilio SMS]
    end
    subgraph Storage
        PrefDB[(Preferences DB)]
        TemplateDB[(Templates DB)]
        IdempDB[(Idempotency Keys)]
        RLRedis[(Rate Limit Redis)]
        ReceiptDB[(Delivery Receipts)]
    end
    subgraph Analytics
        EventBus[Analytics Bus]
        Lake[(Data Lake)]
    end

    Mobile -->|register token| APIGW --> Auth
    APIGW --> PrefSvc --> PrefDB

    EventConsumer --> Kafka
    Kafka --> NotifRouter
    NotifRouter --> PrefSvc
    NotifRouter --> Dedup --> IdempDB
    NotifRouter --> RateLimiter --> RLRedis
    NotifRouter --> TemplateSvc --> TemplateDB
    NotifRouter --> PrioritySvc

    PrioritySvc -->|push| PushQ --> PushWorker --> FCM --> APNs --> Mobile
    PrioritySvc -->|email| EmailQ --> EmailWorker --> SES --> EmailInbox
    PrioritySvc -->|sms| SMSQ --> SMSWorker --> Twilio --> Phone

    PushWorker -.->|fail| RetryQ
    EmailWorker -.->|fail| RetryQ
    SMSWorker -.->|fail| RetryQ
    RetryQ --> PushWorker
    RetryQ -->|exceeded| DLQ

    FCM -->|receipt| ReceiptSvc --> ReceiptDB
    SES -->|webhook| ReceiptSvc
    Twilio -->|status| ReceiptSvc

    ReceiptSvc --> EventBus --> Lake

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class PrefDB,TemplateDB,IdempDB,RLRedis,ReceiptDB storage
    class Kafka,PushQ,EmailQ,SMSQ,PushWorker,EmailWorker,SMSWorker,RetryQ,DLQ async
    class APNs edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Direct API call vs queue-based workers', rationale: 'Direct synchronous calls to providers from the producer are simple but tightly couple producer latency and availability to the provider — a slow Twilio call blocks the producer. Queue-based workers decouple this and give independent scaling, retry, backpressure, and quiet-hours scheduling. Direct is fine for the tiniest services; queue-based is the default at any real scale.' },
      { decision: 'Push (provider initiates delivery) vs in-app polling', rationale: 'Mobile push via FCM/APNs has near-zero battery cost and delivers within seconds, but goes through opaque platform infrastructure that can drop messages silently and requires platform tokens that rotate. In-app polling (when the app opens, fetch notifications) guarantees delivery but only when the user opens the app. Use push for immediate, in-app fetch for the persistent inbox view — most production systems run both, with the inbox as the source of truth.' },
      { decision: 'Single multi-channel queue vs per-channel queues', rationale: 'A single queue is simpler but couples failure modes — a slow Twilio API blocks email deliveries behind it. Per-channel queues isolate provider failures and let each scale independently (email volume often dwarfs SMS). The cost is more infrastructure to operate. Per-channel is correct at any production scale.' },
      { decision: 'Strict ordering per user vs fully parallel', rationale: 'If a user sees "your order shipped" before "your order is being prepared", the experience breaks. Partitioning the queue by user_id preserves per-user ordering. Fully parallel processing is faster but can reorder. Per-user partitioning is the standard middle ground — order within a user, parallelism across users.' },
      { decision: 'Store and forward vs fire and forget', rationale: 'Storing every notification in a persistent DB before attempting delivery is the right default — it enables retry, audit, and post-hoc analysis (why did this user not get the email?). Fire and forget is faster and cheaper but you lose visibility when something breaks. Always store transactional notifications; marketing fan-outs may use fire-and-forget for cost reasons, accepting some delivery opacity.' },
    ],
    keyTakeaways: ['Idempotency keys on every notification are non-negotiable — without them, retries multiply user-visible messages', 'Per-channel worker pools and per-channel queues are the difference between "Twilio is down" being a minor incident and a full outage', 'Preferences and suppressions must be checked at send time, not at queue time — users unsubscribe between queueing and sending more often than you think', 'Quiet hours, rate limits, and category-based prioritization are the difference between "useful notifications" and "the user uninstalls"', 'Multiple providers per channel with automatic failover and canary traffic prevent any single vendor from being a hard dependency'],
    faqs: [
      { question: 'How do you guarantee exactly-once delivery?', answer: 'You cannot — and you should not promise it. Push providers (FCM, APNs), SMS gateways, and email all deliver at-least-once at best, and the user\'s device can also lose and re-fetch. What you can guarantee is at-most-one-from-our-side via idempotency keys: the same idempotency_key from a producer always maps to the same notification_id, so producer retries never multiply. The receiving device may still display the same push twice in pathological cases (rare); on iOS the same APNs payload received twice in the same session is deduped by the OS.\nWhen the application truly requires exactly-once user experience (e.g., legal disclosure), pair the send with a server-side flag and check it on the in-app inbox before showing the message.' },
      { question: 'What happens when a provider goes down for an hour?', answer: 'Three things happen automatically. (1) Health monitoring detects consecutive errors and flips the channel router to the secondary provider within 30 seconds. (2) In-flight messages already in the queue retry with exponential backoff; most clear once the secondary picks them up. (3) The queue depth metric spikes briefly and triggers worker autoscaling to drain the backlog faster once the secondary catches up. A regional outage in both providers is rare but real — in that case messages queue up to the retention limit (24 hours typical) and the on-call triggers a manual failover to a tertiary provider if available, or accepts the loss for marketing and saves transactional for the recovery.' },
      { question: 'How do you handle unsubscribes promptly?', answer: 'The unsubscribe webhook (or one-click email header) writes to the suppressions table immediately. The worker fetches suppressions on every send via a Redis cache with a 10-second TTL, so an unsubscribe is honored within 10 seconds globally. For email specifically, list-unsubscribe headers per RFC 8058 let Gmail and Outlook show a one-click unsubscribe button — the receiving provider posts to our webhook directly. The cost of missing this: regulatory penalties (CAN-SPAM, GDPR) and the sender domain getting flagged by reputation systems.' },
      { question: 'How does the system prevent a buggy producer from spamming users?', answer: 'Multiple layers. (1) Per-tenant per-category rate limits in the API gateway: a producer that suddenly sends 100× baseline for "marketing" is throttled to the cap, excess returns 429. (2) Per-user per-category rate limits: even legitimate producers cannot exceed the user\'s preference. (3) Anomaly detection on producer volume: a baseline-relative spike emits an alert before the cap is hit, giving on-call time to investigate. (4) Kill-switch: every producer can be paused from a config flag without code deploy. Production incidents have shown the kill-switch is the most valuable of the four.' },
      { question: 'Why store every notification in a DB if Kafka already retains it?', answer: 'Kafka retains the event, not the materialized notification — the event "user purchased order #1234" produced potentially three notifications (email receipt, push confirmation, in-app inbox entry) each with their own per-channel render, attempt history, and delivery status. Querying "did Alice receive her receipt?" against Kafka would require replaying and re-rendering, which is expensive and may not be reproducible if templates have changed. The notifications and attempts tables give a queryable, immutable audit trail that customer support and compliance rely on.' },
      { question: 'How do you scale to a million-recipient marketing campaign?', answer: 'A fanout job consumes the campaign spec and produces N per-recipient notification records. Producing 1M records into the DB takes minutes; instead the fanout writes directly into the channel queues with pre-rendered payloads, bypassing the per-record DB write for marketing-class messages (audit is still preserved at the campaign level: "campaign X sent to 1M users; here are aggregate stats"). The channel workers throttle to provider quotas and spread delivery over a configurable window (e.g., 30 minutes for a 1M-recipient campaign) to avoid burning the sender domain reputation with a delivery spike.' },
      { question: 'Why use FCM/APNs instead of a custom push pipeline over WebSockets?', answer: 'FCM and APNs run battery-optimized network stacks deeply integrated with the OS — they wake the device with minimal cost and deliver while the app is killed. A custom WebSocket pipeline requires the app to maintain a connection, which drains battery and dies when the OS suspends the app. Apple\'s and Google\'s policies effectively require their push services for background notifications. WebSockets are appropriate only for active in-app real-time updates (chat, presence), where the app is in the foreground anyway.' },
      { question: 'How do you handle a user with 50 device tokens (old phones, web push, tablets)?', answer: 'Each token is a row in user_devices with last_seen, platform, and a token. On send, the worker fetches all tokens for the user, sends to each, and updates last_seen on success. Tokens with "InvalidRegistration" errors are marked dead immediately. Tokens not seen in 60 days are pruned in a background job — they are usually replaced devices the user never explicitly logged out from. Without pruning, send fanout grows unboundedly for long-tenured users and burns provider quota on dead targets.' },
      { question: 'How do you debug "the user says they did not receive the notification"?', answer: 'Look up by user_id, time window, and category. The notifications table returns the created record, payload, idempotency_key. The attempts table returns every send attempt with provider, response code, and error. Common findings: (a) suppression hit — the user unsubscribed; (b) all attempts failed — provider returned InvalidToken (device replaced); (c) sent successfully but the device did not show it (OS-level user "do not disturb", app not installed, FCM dropped silently). For email, additionally check the bounce/complaint webhook log. Without per-attempt logs, this debugging is impossible — which is why fire-and-forget is dangerous.' },
      { question: 'How do you A/B test notification copy without slowing the pipeline?', answer: 'Templates are versioned; an experiment defines two template versions and a traffic split (50/50). The worker hashes (user_id, experiment_id) to deterministically assign the user to a variant, then picks the corresponding template. Variant assignment and notification_id are written to the experiments table for later attribution. The split happens at render time, not in the queue, so the queue stays single-tenant and there is no throughput penalty. Open and click webhooks feed back to compute lift; significance is computed in the analytics warehouse, not in the hot path.' },
    ],
  },
  {
    id: 14,
    slug: 'design-pubsub',
    title: 'Design a Pub/Sub Messaging System',
    difficulty: 'Medium',
    category: 'Messaging & Streaming',
    tags: ['pub-sub', 'messaging', 'topics', 'subscriptions', 'at-least-once'],
    problemStatement: `Design a publish-subscribe messaging system like Google Pub/Sub or AWS SNS/SQS. Publishers send messages to topics; subscribers receive messages from topics independently. Messages must be durably stored until acknowledged.`,
    requirements: {
      functional: ['Create topics and subscriptions', 'Publish messages to a topic', 'Deliver messages to all subscribers of a topic', 'Acknowledge messages to mark as processed', 'Dead-letter queue for failed messages'],
      nonFunctional: ['At-least-once delivery', 'Message retained for 7 days', 'Low latency delivery < 100ms', 'Scale to millions of messages/sec'],
    },
    capacityEstimates: `1M messages/sec × 1KB avg = 1GB/sec ingestion\n7 days retention × 1GB/sec × 86400 × 7 = ~600TB\nRetained on distributed log (Kafka-like)`,
    solutionBreakdown: [
      { section: 'API Surface', content: 'Topics: POST /topics creates, DELETE /topics/{name} removes. Publishing: POST /topics/{name}/publish with batch of {data, attributes, ordering_key} returns message_ids. Subscriptions: POST /subscriptions creates a subscription on a topic with delivery type (push|pull), ack_deadline, retry policy, and filter expression. Pull: POST /subscriptions/{name}/pull returns up to N messages with ack_ids; POST /subscriptions/{name}/ack acknowledges. Push: the service POSTs to a subscriber URL and expects a 2xx response.' },
      { section: 'Storage as a Distributed Log', content: 'Each topic is sliced into partitions; each partition is a durable, append-only log on disk (segmented files with an index by offset). Messages are immutable once written. Storage is the primary scaling axis: 1GB/sec of ingestion across 1000 partitions is 1MB/sec per partition — comfortable for SSD. The log abstraction is what makes pub/sub fundamentally different from a queue: data is not consumed-and-removed, it is read by offset and lives until the retention policy expires it.' },
      { section: 'Publishing Path', content: 'Publisher sends a batch (typically 100–1000 messages, up to 1MB) to the publish API. The frontend computes the destination partition via hash(ordering_key) if set, otherwise round-robin balanced. The leader of that partition appends to its log, replicates to followers via the underlying consensus or quorum, and returns message_ids once durably committed. Average commit latency: 5–20ms. Producers batch by both size and time (e.g., flush every 10ms or 256KB) to amortize network and consensus overhead.' },
      { section: 'Subscription Model', content: 'Each subscription is a logical cursor on a topic. Multiple subscriptions on the same topic each get an independent view — the topic\'s log is shared, only per-subscription offset pointers (and ack metadata) are stored separately. A subscription has one or more "workers" (push endpoints or pull clients) that share the partitions: each partition is processed by exactly one worker at a time within a subscription, giving per-partition ordering and per-subscription horizontal scaling.' },
      { section: 'At-Least-Once Delivery & Acks', content: 'On pull, the broker hands out a message and starts an ackDeadline timer (default 30s, max 600s). If the subscriber acks before the deadline, the broker durably records the ack and advances the per-subscription offset. If the deadline expires, the message becomes eligible for redelivery. Subscribers can extend the deadline (modifyAckDeadline) when they need more time. The "at-least-once" guarantee comes from this redelivery semantics — a message is only considered delivered once an explicit ack lands.' },
      { section: 'Push Delivery & Backoff', content: 'For push subscriptions the broker POSTs to a configurable URL with a small message batch. The endpoint returns 2xx for ack, anything else for nack. Push uses adaptive flow control: it starts conservatively (e.g., 100 concurrent in-flight) and ramps up while latency stays low; if errors or latency rise, it backs off. Non-2xx responses retry with exponential backoff (1s, 5s, 30s, 5m capped at the subscription\'s max_backoff). After max retry attempts, the message moves to the DLQ.' },
      { section: 'Pull Delivery & Backpressure', content: 'Pull subscribers control their own throughput. The client SDK maintains a pool of streaming pull connections; the broker server-streams messages as fast as the client acks. If the client falls behind (ack latency rises), the broker slows the stream. This is the dominant model for high-throughput consumers because it gives the application explicit control over concurrency and resource use. Push is preferred for low-volume webhooks where running a polling client is overhead.' },
      { section: 'Ordering', content: 'A topic can have ordering disabled (max throughput, messages may reorder across partitions) or enabled per-key. With ordering, the publisher supplies an ordering_key; all messages with the same key route to the same partition and are delivered to the subscriber in publish order. A nack on a key blocks subsequent messages with the same key until the nacked message is acknowledged or sent to the DLQ — preserving ordering at the cost of stalled throughput during failures.' },
      { section: 'Dead Letter Queues', content: 'A subscription configures a DLQ topic and a max_attempts threshold. After max_attempts failed deliveries, the message is published to the DLQ along with metadata (original topic, attempt count, last error). The application processes the DLQ separately — usually by alerting an operator, since DLQ messages are typically "poison" (malformed payloads, persistent bugs). Without a DLQ, a poison message blocks the partition forever in ordered subscriptions.' },
      { section: 'Filtering', content: 'Subscriptions can specify a filter expression on message attributes ("attributes.event_type = \'order.created\'") evaluated server-side. The broker only delivers matching messages, sparing the subscriber from filtering N× messages it does not care about. Filters add a small CPU cost per match; expression complexity is bounded. Filters do not reduce storage — the message is still written to the topic\'s log, just not delivered to non-matching subscriptions.' },
      { section: 'Retention & Replay', content: 'A topic has a configurable retention period (default 7 days). Messages are retained whether or not subscriptions have consumed them — there is no "delete on ack" because subscriptions are independent. A new subscription can start from the oldest retained message (replay) or from now (skip history). seek operations let an existing subscription reset its cursor to a timestamp or specific offset, enabling reprocessing for bug fixes or analytics backfills.' },
      { section: 'Failure Modes & Recovery', content: 'Broker failure: partition leadership fails over via consensus in 1–5s; in-flight publishes retry; in-flight acks may double-deliver (at-least-once). Subscriber failure: ackDeadline expires, messages redeliver to another subscriber in the group. Disk failure: replicas serve while the failed node is replaced and re-streamed. Long subscriber outage: messages accumulate up to retention; the subscription may fall arbitrarily far behind without affecting the topic or other subscriptions.' },
      { section: 'Observability', content: 'Per-topic: publish QPS, publish latency P50/P99, message size distribution. Per-subscription: backlog (oldest unacked message age), ack rate, redelivery rate, expired_ack_count, DLQ rate. Alerts: backlog > 5 minutes (consumer cannot keep up), redelivery rate > 10% (subscriber is failing to ack within deadline), DLQ rate > 0.1% (poison messages or persistent subscriber bug), publish latency above SLA. Per-tenant dashboards show top topics by volume and per-subscription health.' },
      { section: 'Scaling Levers', content: 'Topic throughput: add partitions (online for new messages; existing partitions continue). Subscription throughput: add subscribers — partitions are rebalanced automatically. Cross-region: replicate topics to other regions for disaster recovery (async, with a lag SLI). Cost: messages-per-second pricing dominates; tenants that need predictable throughput can reserve "throughput units" instead of paying per-publish. For peaks 100× baseline, autoscale partition count up to a cap (partition splits are expensive — done carefully).' },
    ],
    diagram: `graph TB
    subgraph Clients
        Pub1[Publisher A]
        Pub2[Publisher B]
        Sub1[Subscriber Service A]
        Sub2[Subscriber Service B]
        SubPush[Push Subscriber Webhook]
    end
    subgraph Gateway
        APIGW[Pub Sub API]
        AuthZ[Authn and IAM]
        AdminAPI[Admin API Topics and Subs]
    end
    subgraph Services
        Publisher[Publish Handler]
        Router[Partition Router]
        SubMgr[Subscription Manager]
        OffsetSvc[Offset Tracker]
        AckSvc[Ack and Lease Service]
        Pusher[Push Delivery Service]
        Puller[Pull Delivery Service]
        DLQSvc[Dead Letter Router]
    end
    subgraph Async
        P1[Partition 1 Log]
        P2[Partition 2 Log]
        P3[Partition 3 Log]
        Retry[Redelivery Scheduler]
        RetentionGC[Retention GC 7 days]
    end
    subgraph Storage
        LogStore[(Distributed Log Disk)]
        OffsetStore[(Subscription Offsets)]
        TopicMeta[(Topic and Sub Registry)]
        DLQStore[(Dead Letter Queue)]
    end
    subgraph Analytics
        Metrics[Metrics Bus]
        Lake[(Audit Lake)]
    end

    AdminAPI -->|create topic| TopicMeta
    AdminAPI -->|create subscription| SubMgr --> TopicMeta

    Pub1 -->|publish msg| APIGW --> AuthZ --> Publisher
    Pub2 -->|publish ordered key| Publisher
    Publisher --> Router
    Router --> P1
    Router --> P2
    Router --> P3
    P1 --> LogStore
    P2 --> LogStore
    P3 --> LogStore
    Publisher -->|message id ack| Pub1

    Sub1 -->|pull| Puller --> P1
    Sub2 -->|pull| Puller --> P2
    Puller --> OffsetSvc --> OffsetStore
    Sub1 -->|ack id| AckSvc --> OffsetSvc

    SubPush -->|push webhook| Pusher --> P3
    Pusher --> SubPush

    AckSvc -->|no ack timeout| Retry --> Puller
    Retry -->|exceeded| DLQSvc --> DLQStore

    LogStore --> RetentionGC
    Publisher --> Metrics --> Lake
    AckSvc --> Metrics

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class LogStore,OffsetStore,TopicMeta,DLQStore storage
    class P1,P2,P3,Retry,RetentionGC async
    class Metrics,Lake analytics`,
    tradeoffs: [
      { decision: 'Push vs pull delivery', rationale: 'Push has lower latency and is operationally simpler for subscribers (no polling client), but the broker must back off when the subscriber struggles — flow control is the broker\'s problem. Pull lets the subscriber control its own throughput precisely; complex consumers with parallelism, batching, and backpressure prefer pull. Use push for low-volume webhooks and integrations; pull for high-throughput stream processors.' },
      { decision: 'At-least-once vs exactly-once delivery', rationale: 'At-least-once is the honest default — redelivery on subscriber failure is unavoidable in a distributed system, and the subscriber must dedupe via idempotency. Exactly-once is achievable inside the system (broker-side dedup of producer retries, transactional acks) but the moment the subscriber writes to an external system, the guarantee leaks. Promise at-least-once and document the dedupe pattern; "exactly-once" pricing tiers are almost always at-least-once plus broker dedup.' },
      { decision: 'Ordering enabled vs disabled', rationale: 'Ordering by key constrains all messages with that key to a single partition, capping throughput per key at one partition\'s worth (~MB/s). Disabled ordering lets messages spread across all partitions for maximum throughput. Enable ordering only for the keys that need it (per-user event streams) and accept the throughput ceiling; never enable globally.' },
      { decision: 'Topic per event type vs single topic with attributes', rationale: 'Topic per event type makes access control, retention, and filtering trivial — each topic has its own settings — but explodes topic count and operational overhead at scale. Single topic with attribute filters keeps topology small but bundles unrelated consumers into one log, where a slow attribute-filter expression hurts everyone. Topic per major domain event (order.created), with attribute filters for variants (region, customer_tier), is the typical compromise.' },
      { decision: 'Sync vs async replication', rationale: 'Synchronous replication (publish only acks once quorum has the message) guarantees no data loss on broker failure but adds 5–10ms commit latency. Async replication acks on local write and replicates in the background — fast but loses recent messages on leader crash. Most production deployments are sync for transactional pipelines, async for analytics; the choice is per-topic.' },
    ],
    keyTakeaways: ['A partitioned, durable log is the right substrate for pub/sub — it gives ordering, replay, and independent subscriptions for free, things queues do badly', 'Per-partition ordering plus per-subscription cursors is what allows the same topic to feed independent consumers at different speeds', 'Backpressure must flow from subscriber to broker; without it, slow subscribers either time out or drown', 'Dead letter queues, ackDeadline extension, and replay are the three knobs that turn at-least-once into "the application can survive any subscriber bug"', 'Multi-region replication is asynchronous in practice — quoting a synchronous global pub/sub SLA in your design is usually a red flag'],
    faqs: [
      { question: 'Why not just use a queue (like RabbitMQ) instead?', answer: 'A queue is consumed once: when a worker takes a message, it disappears. To fan out the same event to three consumers, you either run three queues with the producer publishing thrice, or you set up an exchange. Pub/sub inverts the model — one durable log, many subscriptions with independent cursors. Adding a fourth consumer is a config change, not a publisher change. Pub/sub also makes replay trivial (rewind the cursor); a consumed queue cannot replay.\nIf you only ever need work distribution across identical workers, a queue is simpler. If you have multiple independent consumers, evolve to pub/sub before you regret the per-consumer queues.' },
      { question: 'How do you guarantee a subscriber processes a message exactly once?', answer: 'You cannot — at the system boundary the delivery is at-least-once because the ack might be lost in flight. What you can do is make the subscriber idempotent: each message carries a unique message_id; the subscriber stores processed message_ids in a fast set (Redis or a DB table with TTL) and skips duplicates. For database writes, INSERT ... ON CONFLICT DO NOTHING with message_id as a unique key gives the same effect. The "exactly-once" feature in Kafka is broker-side dedup of producer retries within a transaction; it does not extend through the subscriber\'s side effects.' },
      { question: 'What happens to a message a subscriber never acks?', answer: 'The ackDeadline expires (default 30s, max 10 minutes), and the broker considers the message un-delivered. It is then handed to another subscriber in the subscription\'s worker pool, or to the same subscriber if it is the only one. After max_attempts redeliveries (typically 5–10), the message is published to the configured DLQ topic and removed from the subscription\'s in-flight set.\nUnacked messages that exceed retention age are dropped silently — which is why DLQ + alerting on DLQ rate is mandatory. Without a DLQ, a poison message would loop forever (for unordered subscriptions) or block all subsequent messages with the same key (for ordered).' },
      { question: 'How does the broker scale to a million messages per second?', answer: 'Throughput is the product of partition count and per-partition throughput. A single partition handles 1–10 MB/sec depending on disk and replication, so 1M msg/sec at 1KB each (1 GB/sec) needs ~200 partitions. Partitions are spread across broker nodes; adding nodes adds capacity. Publishers batch messages (100–1000 per request) to amortize the consensus round-trip. Subscribers also batch acks. The hard limit is per-partition throughput — keys that funnel everything to one partition (poor ordering_key choice) cap at single-partition throughput regardless of cluster size.' },
      { question: 'How is this different from Kafka?', answer: 'Pub/sub is the abstraction; Kafka is one implementation. Google Pub/Sub, AWS SNS+SQS, and Kafka all expose a publish/subscribe API but differ in semantics. Kafka exposes the offset explicitly to consumers — consumers track their own progress and can rewind freely. Google Pub/Sub hides offsets and uses ack-based per-subscription cursors — replay is via seek to a timestamp. Kafka has stricter partition affinity (a partition is owned by a consumer until rebalance); Pub/Sub round-robins messages to whichever subscriber is free. Pick Kafka when you need streaming semantics and ecosystem; pick managed pub/sub when you want fewer ops.' },
      { question: 'Why are filters server-side instead of letting the subscriber filter?', answer: 'A subscriber that filters client-side still pays the network cost of receiving every message, and the broker has to deliver them. For a 100K msg/sec topic where the subscriber wants 1%, that\'s 99K msg/sec of wasted bandwidth and CPU. Server-side filters evaluate a small expression per message at the broker, delivering only matches. The cost is broker CPU; the benefit is enormous bandwidth savings for selective subscribers. Filters are kept simple (attribute comparisons, prefixes) so the per-message cost stays predictable.' },
      { question: 'How do ordered subscriptions handle a slow message?', answer: 'In an ordered subscription, messages with the same ordering_key must be delivered in publish order. If message M1 (key=user:123) is being processed and the subscriber has not acked, M2 (key=user:123, published later) cannot be delivered yet — even if a worker is idle. This is the cost of ordering: a slow message blocks the rest of its key\'s queue. Other ordering keys are unaffected (each key is independent). If M1 eventually fails to the DLQ, M2 unblocks. Production guidance: keep ordered processing fast, move slow work out-of-band, and accept that hot keys throttle to single-thread throughput.' },
      { question: 'How do you replay a week of messages without affecting live consumers?', answer: 'Create a new subscription on the topic with seek to the desired start time. The new subscription has its own cursor and worker pool; it processes the historical messages without touching the live subscription\'s cursor. The replay subscriber should be careful to bound its throughput so it does not exhaust shared infrastructure (databases, downstream APIs). Many platforms have a "compute job" mode for replays that runs at lower priority. Once the replay is caught up, delete the subscription. The live subscription is never affected because cursors are independent.' },
      { question: 'What is the durability story — can I lose messages?', answer: 'A published message is durable once the publish API returns success. The broker guarantees that requires the message is written to the replicated log (typically 3 replicas in 3 AZs) before acking. The publisher must check the response — fire-and-forget publish loses messages on broker timeout. After acknowledgement, messages survive until retention expires. Subscribed-but-unacked messages can be re-delivered indefinitely until either acked or DLQ\'d. The data loss windows are: (1) publisher crash before retry succeeds, and (2) bug that fails to publish at all. Use a transactional outbox pattern on the publisher side to eliminate both.' },
      { question: 'How do you handle a subscriber that drops to 1% of normal throughput?', answer: 'Backpressure mechanisms detect rising ack latency and slow message delivery to that subscription. The subscription\'s backlog grows; an alert fires at 5 minutes of unacked messages. Operations options: scale the subscriber up (more workers), increase ack_deadline if processing genuinely takes longer, or temporarily route a portion of the traffic to a parallel subscription for redundancy. If the subscriber is broken (deserializing a bad payload), use seek to skip past the problem message. The pub/sub system itself never drops messages just because a subscriber is slow — it accumulates up to retention.' },
    ],
  },
  {
    id: 15,
    slug: 'design-kafka',
    title: 'Design a Distributed Message Queue (Kafka)',
    difficulty: 'Hard',
    category: 'Messaging & Streaming',
    tags: ['kafka', 'streaming', 'partitions', 'consumer-groups', 'log'],
    problemStatement: `Design a distributed, fault-tolerant message queue that can handle millions of messages per second, retain messages for days, support multiple consumer groups, and guarantee at-least-once delivery. Inspired by Apache Kafka.`,
    requirements: {
      functional: ['Producers publish messages to named topics', 'Consumers read messages by offset', 'Multiple independent consumer groups per topic', 'Configurable message retention', 'Ordered delivery within a partition'],
      nonFunctional: ['< 10ms end-to-end latency', '1M+ messages/sec throughput', 'Horizontal scalability', 'Survives broker failures'],
    },
    capacityEstimates: `1M msgs/sec × 1KB = 1 GB/sec ingestion\n7-day retention: 1GB/sec × 604800 = ~600 TB\nWith 3× replication: ~1.8 PB\n100 broker nodes`,
    solutionBreakdown: [
      { section: 'API & Wire Protocol', content: 'Kafka exposes a binary TCP protocol with verbs Produce, Fetch, ListOffsets, Metadata, JoinGroup, SyncGroup, Heartbeat, OffsetCommit. Producers and consumers cache cluster metadata locally and bypass any load balancer, talking directly to the leader broker for each partition. The protocol is versioned per request type so brokers and clients can roll independently. Request batching is central: one Produce request carries hundreds of messages, one Fetch request returns up to 50MB across many partitions.' },
      { section: 'Topics, Partitions, and Segments', content: 'A topic is a logical name; data lives in N partitions. A partition is a strictly ordered, append-only log split into segment files (default 1GB each) on the broker\'s disk. Each segment has an index mapping offset → byte position for O(log N) seeks. Old segments are deleted when retention.ms expires or compacted when cleanup.policy=compact. Partition count is the single most important throughput knob — more partitions mean more parallel readers and writers, capped by per-broker file descriptor and disk seek limits.' },
      { section: 'Replication & In-Sync Replicas (ISR)', content: 'Each partition has a leader and N−1 follower replicas (typical N=3) on different brokers. Followers fetch from the leader, applying writes in order. A follower stays in the ISR set as long as it is within replica.lag.time.max.ms (default 30s) of the leader. On leader failure, the controller elects a new leader from the ISR — never from out-of-sync replicas, which would lose data. If ISR shrinks to 1, the cluster effectively has no replication for that partition, and writes with acks=all will block.' },
      { section: 'Producer Path', content: 'The producer hashes the message key with murmur2 to pick a partition (or round-robins if no key). Messages accumulate in a per-partition batch buffer (linger.ms + batch.size); when either threshold is hit, the batch is sent to the leader as a Produce request. The leader appends to its log, replicates to followers, and acks back per the acks setting. acks=0 fire-and-forget; acks=1 wait for leader only (loses data on leader crash); acks=all wait for all ISR (durable). enable.idempotence=true tags each batch with a producer epoch + sequence number so the broker dedupes retries within a 5-minute window.' },
      { section: 'Consumer Groups & Rebalance', content: 'A consumer group has a group_id; partitions of subscribed topics are divided among group members such that each partition is owned by exactly one consumer (and each consumer owns one or more partitions). The group coordinator (a broker) assigns partitions via a rebalance protocol when members join or leave. Sticky and cooperative rebalances minimize partition movement during scale-up — older eager rebalances stopped all consumers briefly, hurting tail latency. Offsets are committed back to the broker via OffsetCommit RPC, stored in the internal __consumer_offsets topic keyed by (group, topic, partition).' },
      { section: 'Exactly-Once Semantics', content: 'Two pieces. (1) Idempotent producer: each Produce request carries a producer_id + sequence number; the broker dedupes if the sequence is a duplicate of a recent write. (2) Transactions: producer.beginTransaction() … producer.commitTransaction() atomically writes to multiple partitions and commits offsets in the same transaction (read-process-write). A transaction coordinator on a broker tracks the transaction state in __transaction_state. Consumers with isolation.level=read_committed skip messages from in-flight or aborted transactions. End-to-end exactly-once requires consumers to also write transactionally — partial pipelines remain at-least-once.' },
      { section: 'Log Compaction', content: 'For topics where the latest value per key matters (CDC, state stores), compaction retains only the most recent message per key. The log cleaner periodically scans segments, identifies obsolete entries (keys with newer versions), and compacts them out into a new segment. Tombstones (null payloads) survive compaction for delete.retention.ms to give consumers time to see deletes. Compacted topics are the foundation of Kafka Streams\' state stores and Connect\'s change-data-capture pipelines.' },
      { section: 'Storage & Zero-Copy Reads', content: 'Each partition log is plain files; consumer Fetch requests use sendfile() — the kernel ships file bytes directly from page cache to socket without a userspace copy. This is why Kafka serves 100s of MB/sec per broker on commodity SSDs. The page cache effectively becomes the read cache: recent messages stream from RAM; tail readers may pay one SSD read. Producers, by contrast, write through the OS page cache and rely on fsync timing — Kafka flushes lazily and counts on replication for durability rather than per-message fsync.' },
      { section: 'KRaft vs ZooKeeper', content: 'Until Kafka 2.8, cluster metadata (topic config, ISR, controller election, ACLs) lived in ZooKeeper. KRaft (Kafka Raft) replaces this with a Raft-based metadata quorum inside Kafka itself, removing the external dependency. The controller is a Raft leader within the metadata quorum; metadata changes are appended to a special __cluster_metadata topic. Benefits: faster controller failover, single binary to operate, scale to millions of partitions. KRaft is GA from 3.3 and is the future of the project; new deployments should use KRaft.' },
      { section: 'Tiered Storage', content: 'Recent segments live on broker local SSD for low-latency consumers; older segments migrate to object storage (S3, GCS) for cheap long-term retention. Brokers fetch from object storage transparently when a consumer reads old data. This lets clusters keep months of history at 10× lower cost than full-SSD retention. Consumers reading current data pay nothing; replay jobs pay the tiered-storage read cost. Confluent, AWS MSK, and recent open-source Kafka all support tiered storage.' },
      { section: 'Failure Modes', content: 'Broker failure: partitions led by that broker fail over to another ISR member within seconds; followers catch up from a different leader. Disk failure: the broker marks the disk offline; partitions on that disk move to other brokers via replica reassignment. Network partition: a minority side loses controller and stops accepting writes; rejoining replays the log. Producer slow: batch buffer fills, producer blocks or drops based on configuration. Consumer slow: lag grows; if it grows beyond retention the consumer permanently misses messages.' },
      { section: 'Observability', content: 'Per-broker: under-replicated partitions (any non-zero = data durability at risk), bytes-in/sec, request handler thread idle %, log flush latency. Per-topic: produce/fetch QPS, P99 latency, ISR shrink/expand rate. Per-consumer-group: lag per partition (the dominant SLI — alert when lag > N seconds of data). System: page cache hit ratio for fetches, network bytes by API key (producer vs consumer), disk usage trajectory. Alerts: under-replicated > 0 for 5 minutes, controller failover (frequency), consumer lag growing for any production group.' },
      { section: 'Scaling Levers', content: 'Topic throughput: increase partitions (online; existing data stays in original partitions until the producer key distribution shifts). Cluster throughput: add brokers; use Cruise Control or similar to rebalance partitions. Producer throughput: increase batch.size and linger.ms, enable compression (lz4/zstd cuts wire size by 4–10× for text payloads). Consumer throughput: more consumers in the group (capped by partition count) or larger batches. For 10× burst tolerance, over-provision partition count so consumer parallelism can scale instantly.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Prod1[Producer A]
        Prod2[Producer B]
        ConsA1[Consumer Group A Worker 1]
        ConsA2[Consumer Group A Worker 2]
        ConsB1[Consumer Group B Worker]
        StreamApp[Stream Processor Flink]
    end
    subgraph Gateway
        Bootstrap[Bootstrap Servers]
        SchemaReg[Schema Registry]
    end
    subgraph Services
        Broker1[Broker 1]
        Broker2[Broker 2]
        Broker3[Broker 3]
        Controller[Controller KRaft]
        GroupCoord[Group Coordinator]
        ISR[ISR Tracker]
    end
    subgraph Async
        P1Leader[Partition 1 Leader on B1]
        P1F1[Partition 1 Follower B2]
        P1F2[Partition 1 Follower B3]
        P2Leader[Partition 2 Leader on B2]
        Compaction[Log Compaction Job]
        Retention[Retention Cleaner]
        MirrorMaker[MirrorMaker Cross Cluster]
    end
    subgraph Storage
        Segments1[(Topic Segments Disk B1)]
        Segments2[(Topic Segments Disk B2)]
        Segments3[(Topic Segments Disk B3)]
        OffsetsTopic[(__consumer_offsets)]
        MetaLog[(KRaft Metadata Log)]
    end
    subgraph Analytics
        ConnectSink[Kafka Connect Sink]
        Warehouse[(Warehouse)]
    end

    Prod1 -->|register schema| SchemaReg
    Prod1 -->|produce acks all| Bootstrap --> P1Leader
    Prod2 --> Bootstrap --> P2Leader

    P1Leader --> Segments1
    P1Leader -->|replicate| P1F1 --> Segments2
    P1Leader -->|replicate| P1F2 --> Segments3
    ISR --> P1Leader
    ISR --> P1F1
    ISR --> P1F2

    Controller --> Broker1
    Controller --> Broker2
    Controller --> Broker3
    Controller --> MetaLog
    Controller -->|leader election| P1Leader

    ConsA1 --> GroupCoord
    ConsA2 --> GroupCoord
    GroupCoord -->|partition assignment| ConsA1
    GroupCoord -->|partition assignment| ConsA2
    GroupCoord --> OffsetsTopic

    ConsA1 -->|fetch offset| P1Leader
    ConsA2 -->|fetch offset| P2Leader
    ConsB1 -->|independent cursor| P1Leader
    StreamApp -->|exactly once| P1Leader

    Compaction --> Segments1
    Retention --> Segments2
    P1Leader --> MirrorMaker --> ConnectSink --> Warehouse

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class Segments1,Segments2,Segments3,OffsetsTopic,MetaLog storage
    class P1Leader,P1F1,P1F2,P2Leader,Compaction,Retention,MirrorMaker async
    class ConnectSink,Warehouse analytics`,
    tradeoffs: [
      { decision: 'acks=all vs acks=1 vs acks=0', rationale: 'acks=0 fire-and-forget gives the lowest producer latency but loses any message lost in flight or on a broker crash — unacceptable for transactional data. acks=1 waits for the leader to write locally, fast but loses data if the leader crashes before replication. acks=all waits for all ISR to ack, the only setting that guarantees no data loss as long as ISR size > 1. Use acks=all + min.insync.replicas=2 for financial data; acks=1 for click streams where occasional loss is acceptable.' },
      { decision: 'Push vs pull consumer model', rationale: 'Kafka consumers pull — they ask for messages at their own pace, which gives natural backpressure and lets brokers stay stateless about consumer health. Push systems must track each consumer\'s ability to keep up and slow down when needed. Pull is harder for the consumer (must implement polling, deal with poison messages explicitly) but scales better. Push is more convenient for low-volume webhooks but does not scale to Kafka\'s throughput.' },
      { decision: 'High partition count vs low', rationale: 'More partitions enable more parallel consumers, raising throughput ceiling, but each partition has a per-broker file descriptor cost, increases controller workload, and lengthens rebalance times. As a rule, aim for partition count = expected max parallel consumers × 2–3 (room to grow without resharding) but stay under ~4000 partitions per broker. Resharding is offline and disruptive; over-provisioning at topic creation is cheap insurance.' },
      { decision: 'Compacted vs time-retention topics', rationale: 'Time-retention (delete) topics throw away messages after retention.ms — right for event streams where you only care about recent history. Log-compacted topics keep the latest message per key indefinitely — right for materialized state (configurations, account snapshots, CDC). Mixed mode is available (compact + delete) for state with bounded staleness. Pick by question: "do I need the value or the event history?"' },
      { decision: 'Idempotent producer vs full transactions', rationale: 'Idempotent producer (enable.idempotence=true) gives single-partition exactly-once writes with negligible overhead — the default in modern Kafka. Full transactions add cross-partition atomicity at the cost of a transaction coordinator and 10–20ms of commit latency. Use idempotent always; use transactions only when a single business event spans multiple topics and partial writes would be observed.' },
    ],
    keyTakeaways: ['Partition count is the master throughput knob and the hardest to change after the fact — get it right at topic creation', 'ISR + acks=all + min.insync.replicas=2 is the durability triad; missing any one and the cluster can lose committed writes silently', 'Consumer groups are the unit of horizontal scaling; per-partition single-ownership is what gives ordered, parallel consumption', 'Zero-copy sendfile() and OS page cache are why Kafka serves 100s of MB/sec per broker on plain SSDs — application-level caching is not needed', 'KRaft removes ZooKeeper and is the path forward; tiered storage decouples retention from broker disk and is the path forward for long retention'],
    faqs: [
      { question: 'Why partition by key instead of round-robin?', answer: 'Key-based partitioning ensures all messages for the same entity (user, account, device) land in the same partition, giving ordered processing per entity. Round-robin gives perfect load balance but loses ordering — a downstream view of user X may apply updates out of order. Most production topics use key-based with a careful key choice: user_id for per-user streams, account_id for financial events, device_id for IoT. Round-robin is appropriate only for fully stateless events where ordering does not matter (metrics, logs).' },
      { question: 'How does Kafka achieve such high throughput?', answer: 'Three pillars. (1) Append-only logs on disk are written sequentially — sequential SSD writes are 100–1000× faster than random. (2) sendfile() zero-copy: consumers read directly from page cache to socket without userspace round trip. (3) Batching at every layer — producer batches, broker batches the replication, consumer batches the fetch. The combination delivers 100s of MB/sec per broker on commodity hardware. A common misunderstanding: Kafka is not fast because of memory — it is fast because it uses disk sequentially and lets the OS cache do the heavy lifting.' },
      { question: 'What actually happens during a consumer group rebalance?', answer: 'When a member joins, leaves, or fails to heartbeat, the group coordinator triggers a rebalance. In the eager protocol (old default): all members revoke their partitions, send JoinGroup, the coordinator picks a leader, the leader computes the assignment, members receive their partitions in SyncGroup, processing resumes. Pause duration: 100ms to several seconds. In the cooperative protocol (modern): members keep partitions they still own and only revoke ones being reassigned, dramatically cutting pause time. Use cooperative for any production topic; eager rebalance was the source of many "consumer fell behind during deploy" incidents.' },
      { question: 'Is Kafka really exactly-once?', answer: 'Kafka-internal: yes, with idempotent producer + transactions, a message written and then read within Kafka is exactly-once. End-to-end including external systems: no, unless the consumer also writes its output transactionally to a system that participates in the transaction. Pattern: read from topic A in a transaction, process, write to topic B, commit offsets and B-writes atomically. As soon as the consumer writes to Postgres or calls an external API, you are back to at-least-once with idempotency required at the destination. Marketing materials say "exactly-once"; practitioners say "exactly-once within Kafka, idempotent everywhere else".' },
      { question: 'What happens if a broker disk fills up?', answer: 'Once disk usage hits log.retention.bytes (or the disk fills entirely), one of three things happens depending on configuration. Best case: retention.bytes triggers segment deletion of the oldest data, freeing space — consumers reading old data get OffsetOutOfRange. Worse: the disk fills; the broker stops accepting writes for affected partitions; under-replicated alerts fire; the controller may shuffle replicas to other brokers. Worst: the broker crashes. Operational rule: monitor disk usage with alerts at 70% and 85%; size retention conservatively; have automation that triggers retention reduction on alert.' },
      { question: 'How do you replay an entire topic for backfill?', answer: 'Create a new consumer group with auto.offset.reset=earliest. On first start, members consume from offset 0 of every partition. The processing is independent of the live group — same data, separate cursor. For a 7-day-retention topic with multi-terabyte storage, replay can take hours to days; throttle by processing rate or by adjusting fetch.max.bytes to keep network usage bounded. With tiered storage, replays of old data fetch from S3 transparently — slower than SSD but much cheaper than retaining everything hot.' },
      { question: 'Why does Kafka not just delete a message after a consumer acks?', answer: 'There is no per-consumer ack — multiple consumer groups read the same log independently with their own offsets. Deleting after one consumer reads would break the others. The log model decouples retention from consumption: messages live for a configured time regardless of who has read them. This is the foundational difference from a queue. Time-based retention covers eventual cleanup; log compaction covers the case where you want "just the latest value per key" semantics.' },
      { question: 'How do you handle a poison message that crashes the consumer?', answer: 'Without intervention, the consumer crashes, restarts, reads the same message, crashes again — a loop that blocks the partition forever. Three fixes commonly stacked. (1) Try/catch in the processing loop with a "skip after N failures" policy: after 3 failures on the same offset, log and commit the offset to skip. (2) Dead Letter Topic: failed messages are published to a DLT with metadata, then the original offset is committed. (3) Schema evolution discipline: most poison messages are payloads the consumer cannot deserialize, so a schema registry plus backwards-compatible evolution rules prevents most cases.' },
      { question: 'When should I pick Kafka over RabbitMQ or SQS?', answer: 'Kafka when you need high throughput (100K+ msg/sec), multi-consumer fan-out, message retention with replay, or ordered streams. RabbitMQ when you need rich routing (topic exchanges, headers), per-message TTL with priority queues, or RPC patterns — RabbitMQ is feature-rich but throughput-limited (~50K msg/sec per node). SQS when you want zero ops and your throughput needs are moderate; SQS lacks ordering (except FIFO at lower throughput) and replay. The decision pivots on retention/replay needs more than raw throughput — Kafka\'s log model is what makes it different.' },
      { question: 'Why is partition count so important and so hard to change?', answer: 'Partition count caps consumer parallelism — N partitions means at most N parallel consumers in a group. Setting it too low limits throughput; raising it later is online for new data but does not redistribute existing data, so old data stays in old partitions. More importantly, key-based partitioning hashes to a partition; increasing partition count changes the modulo, so the same key now maps to a different partition — breaking ordering guarantees for consumers that track per-key state. Production topics are over-provisioned at creation (often 2–3× expected need) precisely because resharding is so disruptive.' },
    ],
  },
  {
    id: 16,
    slug: 'design-uber',
    title: 'Design Uber / Ride-Sharing',
    difficulty: 'Hard',
    category: 'Real-time Systems',
    tags: ['geospatial', 'matching', 'real-time', 'location', 'websocket'],
    problemStatement: `Design a ride-sharing application like Uber. Riders request rides, nearby drivers are matched, GPS locations are updated in real time, and pricing is calculated dynamically. Target: 20M trips/day, real-time location updates every 4 seconds.`,
    requirements: {
      functional: ['Rider requests a ride with pickup/dropoff', 'System matches rider to nearest available driver', 'Real-time location tracking for both parties', 'Dynamic pricing based on supply/demand', 'Trip history and payments'],
      nonFunctional: ['Match within 3s of request', 'Location updates every 4s for active trips', '99.9% availability', 'Handle millions of concurrent active drivers'],
    },
    capacityEstimates: `20M trips/day ≈ 230 trips/sec\n5M active drivers × 1 location update/4s = 1.25M location writes/sec\nLocation data: 5M × 50B × 15 updates/min × 60min = ~220GB/hour`,
    solutionBreakdown: [
      { section: 'API Surface', content: 'Riders: POST /rides with {pickup, dropoff, product_type} returns ride_id and an estimated wait time. GET /rides/{id} returns current state and assigned driver location. Drivers: POST /drivers/location every 4s with {lat, lng, heading, speed}; WebSocket /driver/{id}/stream pushes ride offers and updates. Internal: matching service exposes POST /match/{ride_id} which encapsulates the offer loop and returns the accepting driver. All client-facing endpoints are versioned and idempotent on a client-supplied request_id.' },
      { section: 'Geospatial Indexing with H3', content: 'The world is tessellated into H3 hexagonal cells (Uber\'s open-source library) at multiple resolutions: resolution 9 (~150m hexagons) for fine matching, resolution 7 (~1.2km) for supply/demand aggregation, resolution 6 (~3.2km) for city-level analytics. Hexagons have nice properties: every cell has 6 equidistant neighbors (squares have 4), distance between centers is uniform, and kRing(cell, k) returns the k-radius neighborhood in constant time. Each driver\'s location maps to one H3 cell at each resolution.' },
      { section: 'Location Service', content: 'Drivers push a location update every 4 seconds via a WebSocket to the location gateway. The gateway shards drivers by driver_id and writes to Redis: GEOADD city:nyc:drivers lat lng driver_id and an HSET driver:{id} with last_seen, status (available, on_trip, offline). The Redis GeoSet enables GEOSEARCH ... BYRADIUS 3km in 1–5ms. A separate Cassandra time-series stores the full location trail for trip reconstruction and replay — Redis holds only the current location.' },
      { section: 'Matching Engine', content: 'On a ride request, the matching service queries Redis for drivers within 3km of the pickup, filtered by status=available and product_type compatibility. Candidates are scored by a weighted function: 0.4 × distance + 0.2 × ETA + 0.2 × rating + 0.2 × driver acceptance rate. The top driver gets a 15-second offer via WebSocket. If declined or timed out, offer the next. Most matches complete in 1–3 offers within 5–10 seconds. Once 30 seconds elapse with no match, the request is escalated to a wider radius or surge pricing kicks in.' },
      { section: 'Trip State Machine', content: 'States: REQUESTED → MATCHING → MATCHED → DRIVER_ARRIVING → IN_PROGRESS → COMPLETED (or CANCELLED at most steps). Transitions are guarded — a driver can transition MATCHED→DRIVER_ARRIVING only after accepting, IN_PROGRESS requires a "pickup" event with location verification. The active trip state lives in Redis for sub-millisecond reads during the hot ride; on COMPLETED it is persisted to Cassandra (partitioned by trip_id, indexed by driver_id and rider_id) and a Kafka event is emitted for billing, ratings, and analytics.' },
      { section: 'Surge Pricing', content: 'Every 30 seconds, an aggregator counts available drivers and open requests per H3 cell (resolution 7, ~1.2km hexagons). Surge multiplier = max(1.0, demand / (supply + ε)), capped at 3× by policy. A small smoothing window prevents rapid oscillation. Surge is published to Redis and queried by the rider app before they confirm; once confirmed, the multiplier is locked into the ride record. Surge data is also broadcast to nearby drivers as a heatmap to incentivize repositioning toward high-surge zones.' },
      { section: 'WebSocket Gateway', content: 'Riders and drivers maintain persistent WebSocket connections to a stateful gateway tier. Each gateway holds ~10K connections; consistent hashing by user_id picks the gateway. Cross-gateway messaging (e.g., "send driver location to this rider on another gateway") uses Redis pub/sub: each gateway subscribes to its own channel and the location service publishes to (gateway_id):messages. Connections survive 4G/5G reconnects via session tokens; on disconnect, the gateway buffers messages briefly (30s) before treating the connection as dead.' },
      { section: 'ETA & Routing', content: 'ETA computation uses historical road-network speeds keyed by (road_segment, day_of_week, time_bucket) updated daily from anonymized GPS traces. A* search over the road graph with these speeds returns an ETA and a polyline. Real-time conditions (traffic from current active drivers, incidents) layer on as multiplicative adjustments. Pre-trip ETA is cached for 30 seconds per (origin_cell, destination_cell) since users in the same area get the same answer.' },
      { section: 'Pricing & Billing', content: 'Final fare = base_fare + (per_minute × duration) + (per_mile × distance) × surge_multiplier + booking_fee. Computed on trip completion using GPS-recorded distance and time. Tolls, airport fees, and tips are added separately. The fare hits the payment service for capture via the rider\'s saved payment method; the driver\'s payout is recorded with a typical 1-week hold period. All fare line items are stored immutably for receipts and dispute resolution.' },
      { section: 'Trust & Safety', content: 'Fraud detection runs at request time: stolen credit cards (BIN against block-list), account takeover (device fingerprint anomaly), GPS spoofing (impossible-speed jumps between updates). During the trip, an anomaly engine watches for off-route deviations beyond a threshold and pings both rider and driver to confirm safety. The SOS feature shares live trip state with emergency contacts and 911. Driver background checks gate onboarding; periodic re-checks catch lapses.' },
      { section: 'Failure Modes', content: 'Redis GeoSet outage: matching falls back to a degraded scan over a per-city secondary index (PostGIS), with elevated match latency but no full outage. WebSocket gateway crash: clients reconnect in 1–2s; in-flight ride offers retry to next driver if not acked. Payment provider down: trip can complete, fare is pending until the provider recovers; the rider sees "payment pending" not "ride failed". Location data lag (driver in tunnel): rider app interpolates from heading + speed and shows "GPS signal lost" if updates miss > 20s.' },
      { section: 'Observability', content: 'Per-city SLIs: match latency P50/P99 (alert if P99 > 5s), match success rate (alert < 95%), driver location staleness (alert > 10s for active driver fleet), surge multiplier (alert if > 2.5× sustained — usually means supply problem). Per-trip: state transition latency, GPS update gap distribution. WebSocket gateway: connections per node, message rate, reconnection rate. Per-driver alerts for low acceptance, high cancel — anti-gaming.' },
      { section: 'Scaling Levers', content: 'Geospatial sharding: city-level Redis clusters (NYC, SF, London independently) — most rides are intra-city so the locality is natural. WebSocket sharding: by user_id within region. Matching parallelism: per-city matcher instances; for huge cities (Tokyo), shard further by H3 cell. Cassandra: partition trips by trip_id (UUID, scatters perfectly), index by driver_id and rider_id with secondary tables. Surge aggregation: stream processing on Flink against the Kafka location stream.' },
    ],
    diagram: `graph TB
    subgraph Clients
        DriverApp[Driver App]
        RiderApp[Rider App]
    end
    subgraph Edge [Realtime Edge]
        WSGW[WebSocket Gateway]
        APIGW[API Gateway]
        PubSub[Redis Pub Sub]
    end
    subgraph Services
        LocSvc[Location Service]
        Match[Matching Service]
        Trip[Trip Service]
        Surge[Surge Pricing Svc]
        Pay[Payment Service]
        Rate[Rating Service]
        Routing[ETA and Routing Svc]
        UserSvc[User and Auth Svc]
        NotifSvc[Notification Service]
    end
    subgraph Async
        EventBus[Kafka Trip Events]
        SurgeJob[Surge Aggregator H3 Hex]
        PayBatch[Payment Settlement]
        MLTrain[ETA Model Trainer]
    end
    subgraph Storage
        GeoRedis[(Redis GeoSet)]
        TripRedis[(Active Trip Cache)]
        TripDB[(Completed Trips Cassandra)]
        PayDB[(Payments DB)]
        UserDB[(User DB)]
        RatingDB[(Ratings DB)]
        SurgeStore[(Surge Multiplier Cache)]
    end
    subgraph Analytics
        Lake[(Data Lake)]
        Feature[Feature Store]
    end

    DriverApp -->|GPS every 4s| WSGW --> LocSvc --> GeoRedis
    LocSvc --> EventBus

    RiderApp -->|request ride| APIGW --> Match
    Match -->|GEORADIUS| GeoRedis
    Match --> Surge --> SurgeStore
    Match -->|offer trip| WSGW --> DriverApp

    DriverApp -->|accept| WSGW --> Trip --> TripRedis
    Trip --> EventBus
    Trip -->|driver loc| PubSub --> WSGW
    WSGW -->|live location| RiderApp
    Trip --> Routing
    Routing --> Feature

    Trip -->|complete| TripDB
    Trip --> Pay --> PayDB
    Pay --> PayBatch

    RiderApp -->|rate driver| APIGW --> Rate --> RatingDB
    Rate --> UserSvc
    APIGW --> UserSvc --> UserDB
    Trip --> NotifSvc
    NotifSvc --> RiderApp
    NotifSvc --> DriverApp

    EventBus --> Lake
    EventBus --> SurgeJob --> SurgeStore
    Lake --> MLTrain --> Feature

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class GeoRedis,TripRedis,TripDB,PayDB,UserDB,RatingDB,SurgeStore storage
    class EventBus,SurgeJob,PayBatch,MLTrain async
    class WSGW,APIGW,PubSub edge
    class Lake,Feature analytics`,
    tradeoffs: [
      { decision: 'Redis GeoSets vs PostGIS', rationale: 'Redis is in-memory with sub-millisecond GEOSEARCH for the "nearest 50 drivers" pattern that matching needs. PostGIS gives richer spatial query capabilities (polygon contains, complex joins) but is disk-based and slower per query — 10–50ms versus 1–5ms. Use Redis for the hot matching path; use PostGIS for analytics and zone management (no-go zones, airport pickup areas).' },
      { decision: 'H3 hexagons vs S2 cells vs geohashes', rationale: 'H3 hexagons have uniform neighbor distance and clean kRing semantics, making aggregation and density computations natural — Uber uses H3 throughout. S2 cells (Google) have hierarchical containment that\'s good for routing but rectangular distortion at high latitudes. Geohashes are simpler but suffer edge-of-cell issues — a driver in one hash may be closer to a rider in an adjacent hash than to drivers in their own. H3 is the right pick for ride matching; S2 for global covering operations; geohashes only for simple key-based lookups.' },
      { decision: 'Push vs pull location updates', rationale: 'Push (drivers stream every 4s) gives sub-second freshness, essential for matching accuracy and ETA quality. Pull (matching service queries driver app on demand) avoids constant bandwidth but adds match latency by N round-trips. Push wins for active fleets; the cost is constant location ingestion (~1M writes/sec at scale), absorbed by Redis sharding. Drivers offline or idle can drop to lower-frequency pings to save battery.' },
      { decision: 'Stateful WebSocket gateway vs stateless polling', rationale: 'WebSockets give second-level location updates with low overhead but force a stateful gateway tier — failover and load balancing are harder, and a gateway crash disconnects 10K clients. Polling is stateless and simpler but adds latency and bandwidth (every poll is a full HTTP exchange). WebSockets are required for the active ride experience; some implementations fall back to long-poll for restrictive network conditions.' },
      { decision: 'Trip state in Redis (hot) vs SQL (durable)', rationale: 'Redis gives sub-millisecond state reads during the trip, essential for the matching loop, real-time updates, and surge calculations. But Redis is not the source of truth — a crash loses in-flight trips. The pattern: Redis for the live state, Cassandra for the audit log via Kafka events, and a periodic checkpoint of in-flight trip state to Cassandra so a Redis disaster does not lose customer rides. Trade-off: complexity for performance.' },
    ],
    keyTakeaways: ['Redis GeoSets plus H3 hexagonal grids are the geospatial primitives that make sub-second matching feasible at city scale', 'Per-city sharding is natural — rides do not cross cities, so the data partitioning matches the business reality', 'The matching offer loop (offer → 15s wait → next driver) is a state machine; building it as one is much simpler than ad-hoc retry logic', 'Surge pricing is supply/demand per H3 cell on a 30-second cadence, not a magic ML algorithm — the smoothing is what makes it usable', 'WebSocket gateways with consistent hashing by user_id keep the connection topology stable; cross-gateway routing via Redis pub/sub handles the spillover'],
    faqs: [
      { question: 'How does the matching offer loop avoid double-assigning a driver?', answer: 'When a driver receives an offer, the matching service writes a soft hold (driver:{id}:held_for = ride_id with a 20-second TTL) in Redis. Other ride requests querying for available drivers filter out held drivers. If the driver accepts, the hold is converted to a hard assignment (driver:{id}:on_trip = ride_id) and the trip moves to MATCHED. If the driver rejects or the offer times out, the hold expires and the driver becomes available again. The TTL is the safety net — even if the matching service crashes, the hold self-clears in under a minute.\nFor the rare race where two ride requests both think they have a driver (one held in flight while the other was just confirmed), the second SETNX fails and the matching service falls back to the next candidate.' },
      { question: 'How do you handle a driver in a poor GPS area like a tunnel?', answer: 'Location updates pause; the rider app shows "GPS signal lost" if no update arrives in 20 seconds. The rider sees the driver\'s last known position with a fading marker. On the matching side, drivers without recent updates (no location in 30s) are marked stale and excluded from matching — they should not receive offers they may never see. On exit from the tunnel, the driver app sends a buffered position and immediately rejoins the live pool. For surge and supply calculations, stale drivers are counted as unavailable.' },
      { question: 'How do you scale to 5 million concurrent drivers?', answer: 'Shard everything by geography. Each major city has its own Redis cluster, its own matching service instances, its own WebSocket gateway pool. NYC drivers never touch the London cluster. Within a city, further shard the WebSocket gateway by user_id (so 5M drivers in a city become 500 gateway nodes at 10K conns each). Matching is also parallelizable per H3 cell — a ride in cell X queries only that cell\'s candidates, and disjoint cells are independent. Cross-city rides (airport transfers) are rare enough to handle as a special case.' },
      { question: 'What happens if Redis goes down?', answer: 'Redis is the hot store for live state. The fallback is a degraded mode: the location service flips to PostGIS-backed reads (10–50ms per query instead of 1–5ms), match latency goes from sub-second to seconds, but the system keeps matching. In-flight trip state was checkpointed to Cassandra at every state transition; the checkpoint catches up the Redis replacement on recovery. Riders see "matching is slower than usual" but rides complete. The all-Redis recovery typically takes minutes (replicas promote, failed shards rebuild from snapshots in S3).' },
      { question: 'How is surge pricing not just "charge more during peak"?', answer: 'Surge balances supply and demand: when there are more open requests than available drivers in a cell, the price rises to (a) discourage some marginal riders (riders who would not pay 2× shift to other modes), (b) attract drivers from neighboring cells (drivers see the heatmap and reposition), and (c) compensate the driver who takes the ride. The 30-second update cycle plus smoothing prevents wild oscillation. Without surge, popular times degenerate into long waits and rider abandonment; with surge, the market clears. The cap (3× typical) is a policy choice to limit gouging perceptions, not a math constraint.' },
      { question: 'How do you ensure a driver actually picked up the rider at the right place?', answer: 'The pickup event requires the driver to tap "Start Trip" in the app, which is only enabled when the driver\'s GPS is within ~100m of the pickup point. If the driver tries to start the trip from a wrong location, the app refuses. For known-bad-GPS areas (large venues, airports), geofences override with looser validation. The trip recording starts at the verified pickup; the fare is calculated from the GPS trace between pickup and dropoff, both verified against the road network to detect anomalies (driver took a wildly off-route path).' },
      { question: 'Why store the location history in Cassandra and not just Redis?', answer: 'Redis holds only the current location to keep memory bounded — 5M drivers × ~100 bytes = 500MB, fits comfortably. The trail (every 4s for the entire trip) is 100s of MB per long trip across the fleet, accumulating to TB per day. Cassandra is built for this write pattern — time-series data partitioned by (driver_id, day) with compaction. Use cases: trip dispute reconstruction, route optimization training data, driver behavior analysis, regulatory compliance (some jurisdictions require trip logs). Querying historical data is rare so Cassandra\'s eventual consistency model fits well.' },
      { question: 'How do you handle a rider canceling after a driver has been on the way for 5 minutes?', answer: 'Cancellation policy: free within the first 2 minutes after assignment; cancellation fee applies after. The trip state transitions to CANCELLED; the driver becomes available again with a "near miss" credit (counts toward their acceptance metric so this cancel does not penalize them). The cancellation fee is captured from the rider\'s payment method and paid (in part) to the driver as compensation for the dead-headed miles. Drivers who cancel after acceptance have stricter penalties and lower acceptance rates lose access to some incentives.' },
      { question: 'How do you compute ETA accurately?', answer: 'Three layers. (1) Historical road speeds: every road segment has expected speed by (day_of_week, time_bucket) trained from billions of anonymized trip GPS traces. (2) Real-time: active driver speeds on the same segments in the past few minutes adjust the historical estimate up or down. (3) Incidents: known incidents (construction, accidents from third-party feeds) apply additional slowdowns. The A* search over the road graph uses these adjusted weights. The ETA is recomputed every 30 seconds during the trip as conditions change. The accuracy SLI is "actual arrival within ±2 minutes of last ETA" — a key driver of rider satisfaction.' },
      { question: 'How does the system prevent driver-rider fraud (fake trips for incentives)?', answer: 'Anti-collusion detection runs on the trip event stream. Flags: pickup and dropoff at the same location, drivers and riders with a repeated history together, trip GPS trace consistent with "device stationary" rather than actual movement (no speed variance, no compass changes), trips that consistently maximize incentive payout. Flagged trips are held in review; confirmed fraud forfeits the payout and may lead to account suspension. Trust signals are also computed (verified phone, payment method age, complaint history) and used to weight the fraud score. This is an arms race — fraudsters evolve, so does detection.' },
    ],
  },
  {
    id: 17,
    slug: 'design-whatsapp',
    title: 'Design WhatsApp / Chat System',
    difficulty: 'Hard',
    category: 'Real-time Systems',
    tags: ['chat', 'websocket', 'end-to-end-encryption', 'message-delivery', 'presence'],
    problemStatement: `Design a real-time messaging application like WhatsApp. Users exchange messages 1:1 and in groups. Messages must be delivered reliably, with offline delivery when the recipient reconnects. Target: 2B users, 100B messages/day.`,
    requirements: {
      functional: ['Send/receive messages (text, media, voice)', 'Group chats up to 1,024 members', 'Message delivery status (sent, delivered, read)', 'Online presence indicators', 'End-to-end encryption'],
      nonFunctional: ['< 100ms message delivery for online users', '99.99% message delivery guarantee', '100B messages/day', 'Offline message queuing'],
    },
    capacityEstimates: `100B messages/day ≈ 1.16M messages/sec\nAvg message size: 200B\nBandwidth: 1.16M × 200B = ~230MB/sec\nMedia goes to separate blob storage`,
    solutionBreakdown: [
      { section: 'API and Wire Protocol', content: 'Long-lived WebSocket between client and Chat Server carries a binary framed protocol (protobuf or MTProto-style). Frames: SEND, ACK, DELIVERED, READ, TYPING, PRESENCE, PING. REST is used only for setup: POST /devices (register a device + identity key + signed prekey bundle), GET /prekeys/{user_id} (fetch keys to start a session), POST /media/upload (returns a CDN URL plus a media_key for E2EE blob encryption).\n\nEvery client message carries a client-generated message_id (UUID) so the server can dedupe retries idempotently. Servers ACK with a server_id assigned by the message store; the pair (sender_device_id, server_id) is the canonical identity used in receipts.' },
      { section: 'Connection Registry and Routing', content: 'Each Chat Server holds tens of thousands of WebSocket sessions. A connection registry (Redis with key user_id mapped to {chat_server_id, device_ids[], conn_token}, TTL refreshed by heartbeat) lets any server route a message to the right edge in one hop.\n\nThe registry is sharded by user_id hash with 3-way replication. On Chat Server crash, all stale entries expire within 30s (heartbeat TTL). Clients reconnect, the new server writes the registry entry, and any in-flight messages are retried from the sender side using the stored message_id for dedup.' },
      { section: 'Message Store and Delivery Semantics', content: 'Messages live in Cassandra in two tables. messages_by_user (partition: recipient_id, clustering: server_id desc) is the per-user inbox used for offline pull and pagination. messages_by_thread (partition: thread_id, clustering: server_id) backs chat history scrolling and search. Both are append-only; deletions write tombstones.\n\nDelivery is at-least-once with client-side dedup by message_id. The server writes the message before fanning out; if a recipient is online the WebSocket push is best-effort and the inbox row is the source of truth. The DELIVERED ACK travels back through the registry to the sender and updates a separate receipts table (partition: message_id) read by the UI checkmarks.' },
      { section: 'Offline Delivery and Multi-Device Sync', content: 'When a device reconnects it sends RESUME with the last server_id it has. The server queries messages_by_user WHERE server_id > last_seen, streams the missing rows over the socket, then switches to live mode. For users with N paired devices each message_id has N envelopes (each encrypted to a different device key) so each device pulls only what it has not seen.\n\nDevice keys live in the prekey store; when a new device is added (linked via QR pairing) the sender refetches prekeys and starts a new Signal session. We never re-encrypt history server-side because the server has no plaintext.' },
      { section: 'End-to-End Encryption with Signal Protocol', content: 'Each user maintains a long-term identity key, a signed prekey rotated weekly, and a queue of one-time prekeys uploaded on registration. Starting a chat: sender fetches a recipient prekey bundle, runs X3DH to derive a shared secret, then bootstraps a Double Ratchet session. Every message generates a fresh symmetric key via the ratchet, giving forward secrecy and post-compromise security.\n\nThe server only ever sees ciphertext plus routing metadata (sender_id, recipient_id, message_id, timestamp). Media is encrypted client-side with a random media_key; the key travels in the encrypted message body, the blob sits on the CDN unencrypted-looking but useless without the key.' },
      { section: 'Group Messaging and Sender Keys', content: 'Naive fan-out (encrypt N times, one per member) is O(N) on the sender for every message — fine at 10 members, painful at 1,024. WhatsApp uses Sender Keys: each member of a group maintains a chain key that other members already have. A message is encrypted once with the chain key and fanned out as a single ciphertext.\n\nServer side, the Fanout service expands the group recipient list (from group_membership Cassandra table) into per-recipient inbox writes and per-server delivery pushes. Large groups (>200) go through an async queue (Kafka) so the sender does not wait for thousands of writes synchronously. Membership changes (add/remove) trigger a sender-key rotation so removed members cannot read future messages.' },
      { section: 'Receipts and Presence', content: 'Three states per message per recipient: sent (server has it), delivered (recipient device has it), read (recipient opened the chat). Receipts are themselves small messages that travel back through the same WebSocket path. To keep cost down they batch: a device coalesces all read receipts for a thread into one packet at flush time.\n\nPresence (online, last-seen, typing) is ephemeral. Typing indicators go through a Redis pub/sub keyed by thread_id with a 5s TTL — never written to durable storage. Last-seen is a per-user epoch updated on disconnect; privacy settings let users hide it entirely, in which case the server still tracks it but suppresses it from peers.' },
      { section: 'Media Pipeline', content: 'Client encrypts a photo or voice note with a random AES-GCM media_key, uploads the ciphertext to a media ingest endpoint that issues a pre-signed URL into blob storage (S3 or equivalent). A transcoder generates compressed variants (thumbnails, lower-bitrate audio) encrypted to the same media_key so they share the key envelope.\n\nThe encrypted reference (cdn_url + media_key + sha256) is what travels in the chat message. Recipients fetch from the nearest CDN POP, decrypt locally, and verify the hash. The CDN never sees plaintext and the server never sees the key in cleartext.' },
      { section: 'Push Notifications for Background Devices', content: 'Mobile OSes kill the WebSocket when the app backgrounds. Chat Server detects no socket within ~30s and falls back to a push notification via APNs (iOS) or FCM (Android) using stored device push tokens. The notification carries only the message_id and minimal metadata — the actual ciphertext stays in the inbox until the app foregrounds.\n\nThis matters for E2EE: APNs and FCM are third-party and untrusted, so we never put readable content in the push payload. The notification wakes the app, which then opens a socket, drains the inbox, and decrypts locally to render the actual text.' },
      { section: 'Storage Layout and Retention', content: 'Cassandra clusters split by purpose: one for inboxes (writes dominated, partitioned by recipient_id), one for thread history (reads dominated, partitioned by thread_id), one for receipts (small rows, partitioned by message_id). Each is sized for the working set — typically 30 days hot in SSD, older data dropped or moved to cold object storage if regulatory retention is required.\n\nMedia blobs default to a 30-day TTL; if all paired devices have ACKed delivery sooner, a sweeper deletes the blob and the message rows it referenced. Inbox rows live until every paired device of the recipient has confirmed delivery, then a GC compaction removes them.' },
      { section: 'Scaling Levers', content: 'Vertical: each Chat Server handles ~100K concurrent sockets on a modern host (kernel tuning, epoll, no per-connection thread). Horizontal: connection registry is sharded by user_id; chat servers are stateless beyond the in-memory sockets.\n\nGeo: clients connect to the nearest POP via Geo-DNS. Cross-region message delivery routes through a backbone, but most traffic is intra-region because social graphs cluster geographically. For huge groups that span regions, fanout runs in each region against the local membership slice rather than from one origin.' },
      { section: 'Failure Modes and Recovery', content: 'Chat Server dies mid-send: inbox row was written first, so the message survives; sender sees no ACK within 5s and retries the same message_id, which dedupes. Network partition between regions: writes still succeed locally, fanout to the remote side queues in Kafka and drains when the link returns. Cassandra node loss: replication factor 3 across racks plus hinted handoff covers single-node outages with no data loss.\n\nA harder case is phantom delivered — the server pushed but the recipient device crashed before ACK. The client re-RESUMEs after restart with its last known server_id; the inbox replay covers the gap. The mistake we explicitly avoid is updating the receipts table without an actual client ACK; receipts always come from the recipient.' },
      { section: 'Observability and Abuse Controls', content: 'Per-server metrics: open_sockets, msg_in_per_sec, fanout_lag_p99, registry_hit_rate, push_fallback_rate. Pages on fanout_lag_p99 > 5s (a back-pressure signal that pulls in extra fanout workers) and on push_fallback_rate spike (often an APNs outage).\n\nAbuse: per-sender rate limits at the API gateway (e.g., 100 msgs/min for a new account, scaling with reputation), plus group join-rate caps to slow spam blasts. Server cannot read content, so abuse signals come from metadata: send velocity, recipient-not-in-contacts ratio, recipient-block ratio. Hashed phone numbers and contact-graph signals catch most spam accounts before they hit recipients.' },
      { section: 'Privacy and Compliance Considerations', content: 'Phone numbers are the primary identifier and are hashed before storage where possible. Backups (iCloud or Google Drive) are encrypted with a user-chosen key the server cannot recover — losing that key means losing history, which is the explicit privacy promise.\n\nLawful-intercept requests can return metadata (who messaged whom, when, from where) but never content, because the server has no key. Some jurisdictions (UK Online Safety Act, EU CSAM proposals) push to weaken this; the architectural answer is that on-device classification before encryption is the only mechanism that preserves the E2EE guarantee, and even that is controversial.' },
    ],
    diagram: `graph TB
    subgraph Clients
        UserA[User A Device]
        UserB[User B Device]
        GroupMember[Group Member Device]
        WebSession[Web Companion]
    end
    subgraph Edge
        GeoDNS[Geo-DNS]
        WSLB[WebSocket Load Balancer]
        CDN[Media CDN]
    end
    subgraph Gateway
        APIGW[REST API Gateway]
        Auth[Auth and Device Pairing]
    end
    subgraph Services
        ChatA[Chat Server A]
        ChatB[Chat Server B]
        ChatC[Chat Server C]
        Presence[Presence Service]
        FanoutSvc[Group Fan-out Service]
        ReceiptSvc[Delivery Receipt Service]
        MediaSvc[Media Upload Service]
        E2EE[E2EE Key Service Signal]
        PushSvc[Push Gateway APNs FCM]
        ContactSvc[Contact and Profile Svc]
    end
    subgraph Async
        FanoutQ[Group Fan-out Queue]
        MediaProc[Media Transcoder]
        OfflineDeliver[Offline Delivery Job]
        TombstoneGC[Delivered Message GC]
    end
    subgraph Storage
        Registry[(Connection Registry Redis)]
        OfflineQ[(Offline Queue Cassandra)]
        UserDB[(User and Contacts DB)]
        GroupDB[(Group Membership DB)]
        KeyStore[(Public Key Store)]
        MediaBlob[(Media Blob S3)]
        ReceiptDB[(Read Receipts)]
    end
    subgraph Analytics
        EventBus[Kafka Events]
        Lake[(Data Lake)]
    end

    UserA -->|DNS| GeoDNS --> WSLB
    UserA -->|WebSocket| ChatA
    UserB -->|WebSocket| ChatB
    GroupMember -->|WebSocket| ChatC
    WebSession -->|WebSocket| ChatA

    UserA -->|register pubkey| APIGW --> Auth --> E2EE --> KeyStore
    APIGW --> ContactSvc --> UserDB

    UserA -->|send 1-1 ciphertext| ChatA
    ChatA --> Registry
    ChatA -->|recipient on B| ChatB
    ChatB --> UserB
    ChatB -->|delivered| ReceiptSvc --> ReceiptDB
    UserB -->|read| ReceiptSvc

    ChatA -->|offline recipient| OfflineQ
    OfflineQ --> OfflineDeliver --> ChatB

    UserA -->|send group msg| ChatA --> FanoutSvc --> GroupDB
    FanoutSvc --> FanoutQ --> ChatC
    ChatC --> GroupMember

    UserB -.->|typing presence| Presence --> Registry
    Presence -->|broadcast| ChatA

    UserA -->|upload media| MediaSvc --> MediaBlob
    MediaSvc --> MediaProc --> MediaBlob
    GroupMember -->|fetch media| CDN --> MediaBlob

    ChatB -.->|app closed| PushSvc --> UserB

    ChatA --> EventBus --> Lake
    OfflineQ --> TombstoneGC

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class Registry,OfflineQ,UserDB,GroupDB,KeyStore,MediaBlob,ReceiptDB storage
    class FanoutQ,MediaProc,OfflineDeliver,TombstoneGC async
    class GeoDNS,WSLB,CDN edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Server-stored history vs client-only', rationale: 'Server-stored history makes multi-device sync, search, and post-restore recovery work cleanly but creates an attractive surveillance target even when contents are E2EE. Client-only (Signal classic) is purer privacy but breaks the moment a user drops a phone. WhatsApp compromises: server holds undelivered ciphertext temporarily, then deletes; backup is encrypted with a key only the user knows.' },
      { decision: 'Sender-key fanout vs per-recipient encryption in groups', rationale: 'Per-recipient encryption (encrypt N times) is the simplest and gives perfect post-compromise security per pair, but it makes the sender pay O(N) cost on every message and is unworkable above ~50 members. Sender keys amortize encryption to O(1) per message at the cost of needing a full chain rotation when membership changes. Use per-recipient for small groups, sender keys above ~30 members.' },
      { decision: 'WebSocket vs long-poll vs MQTT for the client transport', rationale: 'WebSocket gives bidirectional framing over one TCP socket with low overhead — the default for modern chat. Long-poll wastes bandwidth and battery on mobile. MQTT (used by Facebook Messenger originally) has tiny framing overhead and excellent battery characteristics but is harder to debug at scale and few CDNs proxy it well. WebSocket plus push-as-fallback is the operationally cleanest answer in 2024.' },
      { decision: 'Read receipts on vs off by default', rationale: 'Read receipts boost engagement (you reply faster when you know they read it) but create real social and safety harms; abusive partners weaponize them. WhatsApp made the receipts symmetric (if you turn off, you cannot see others either) which is a defensible compromise. The system cost is one extra packet per opened thread — cheap; the product cost is the harder call.' },
      { decision: 'Cassandra vs Kafka log for the per-user inbox', rationale: 'Cassandra inboxes give cheap point-lookups, TTL, and natural per-user partitioning. A Kafka log per user has nicer streaming semantics but Kafka does not love billions of partitions; you would have to bucket many users per partition and pay an extra index. Cassandra wins for the inbox; Kafka stays as the fanout backbone.' },
    ],
    keyTakeaways: [
      'The connection registry is the routing fabric — every stateless service can find a user device in one hop without broadcasting',
      'Client-generated message_id plus server-assigned server_id gives at-least-once delivery with cheap client-side dedup',
      'Signal Double Ratchet plus Sender Keys gives both forward secrecy and O(1)-per-message group fanout — the modern E2EE baseline',
      'Receipts must originate from the recipient device; the server cannot fabricate a delivered status without lying to the sender',
      'Push notifications are an untrusted side-channel: they wake the app and carry the message_id, never the plaintext',
      'Cassandra inboxes plus a backbone Kafka for cross-region fanout decouple per-user scale from per-group scale',
    ],
    faqs: [
      { question: 'How do you deliver exactly-once when the network can drop ACKs at any point?', answer: 'You do not — you build exactly-once effects on top of at-least-once delivery and client-side dedup. The client generates a UUID message_id; the server writes to the inbox keyed by message_id with a uniqueness constraint, so duplicate retries collapse. The recipient device tracks the highest server_id it has ACKed and ignores re-deliveries below it. From the user perspective the chat shows the message exactly once, regardless of how many retries flowed underneath.' },
      { question: 'Why does WhatsApp link a new device via QR instead of just letting the cloud sync it?', answer: 'Because there is no cloud key. Every device has its own identity key and Signal session with each peer; when you add a new device, the new device must establish fresh Signal sessions with everyone it will chat with. QR pairing transfers the identity key from the existing phone to the new device locally (no server in the path), which both proves possession and means the cloud never holds plaintext-capable keys. The historic absence of multi-device sync was a direct consequence — modern WhatsApp solved it with companion sessions but still anchors to the primary device key.' },
      { question: 'What happens to messages sent to me while my phone was off for a week?', answer: 'They sit in your Cassandra inbox encrypted to your device key. The inbox row carries a TTL (typically 30 days for undelivered) so storage cannot grow forever for abandoned accounts. When your phone reconnects it RESUMEs from its last server_id, streams everything new in chronological order, ACKs as it goes, and the server can then GC the delivered rows. If you blew past the TTL, those messages are gone — the senders see a single-tick "sent" indefinitely.' },
      { question: 'How do typing indicators and presence work without writing a row to the DB per keypress?', answer: 'Typing is a Redis pub/sub event keyed by thread_id with a short TTL (5s). The sender publishes "typing"; subscribers in that thread receive it through their Chat Server. Nothing durable. Last-seen is a single epoch per user updated on disconnect, kept in the connection registry. Online/offline is whether the registry entry exists at all. None of this touches Cassandra, which is the reason it costs almost nothing per user even at billions of users.' },
      { question: 'Can the server suppress a message between users?', answer: 'It can prevent delivery, but it cannot read or modify the ciphertext. If a regulator forced suppression by recipient_id, the message would silently not show up — but a paranoid client running a transparency log of expected message_ids would see the gap. There is active research (Auditable Messaging, key transparency like CONIAKS) on giving users cryptographic proof the server is not censoring. None of it is universally deployed.' },
      { question: 'How does the system handle a network partition between two regions during a group chat?', answer: 'Senders in region A keep writing to their local Cassandra inbox and to the local fanout queue (Kafka). Recipients in region A receive instantly. The cross-region replication link backs up; messages destined for region B sit in a buffered Kafka topic. When the link heals, the consumer drains in order, writing to region-B inboxes; region-B recipients then get the backlog the next time they RESUME. Within each region the experience is normal; across regions there is delivery delay but no data loss.' },
      { question: 'Why store the message twice (per-user inbox and per-thread history)?', answer: 'They serve different read patterns. The per-user inbox is the unread queue — the device asks for everything newer than its last server_id; it is partition-aligned with the recipient and naturally sized to a single device pull. The per-thread store is for scrolling history in a conversation — it is partitioned by thread_id so loading the last 50 messages of one chat is one partition read. Trying to serve both from one table either overloads partitions (one chat with millions of messages) or scatters reads across the cluster.' },
      { question: 'How do you keep group fanout latency under a second when a 1,024-member group is split across many regions?', answer: 'Fanout is hierarchical. The sender writes once; a regional fanout worker reads the membership table, splits it by region, and posts one job per region to a backbone Kafka. Each region runs its own fanout against its slice of members in parallel. Even at 1,024 members the per-region slice is typically <100, so each region completes in tens of ms. End-to-end p99 stays sub-second; the actual user-visible latency is dominated by the device push (APNs/FCM) for offline members, which is out of our control.' },
      { question: 'Is end-to-end encryption real if the server holds the prekey bundle?', answer: 'Yes — prekeys are public keys. The server distributes them to senders who want to start a session, just like a phonebook. The private half never leaves the device. The only attack the server could mount is a man-in-the-middle: substituting its own prekey for the recipient. Safety numbers (the long string in Verify Security Code) are a fingerprint of the actual session keys; both users compare them out of band to detect MITM. Whether users actually compare them is the weak link in practice.' },
      { question: 'How would you add disappearing messages without losing the E2EE property?', answer: 'The expiry timer is signed metadata in the message, agreed by sender and recipient. The server treats it as opaque ciphertext and stores it for delivery as usual, then deletes the inbox row on its own schedule. The recipient device enforces the timer on the UI side — when the message expires it is deleted from local storage. Because the server never had plaintext, there is no server-side concept of "expired content"; deletion on the server is independent best-effort. The honest framing: disappearing messages are a client-side promise that depends on both endpoints being honest.' },
    ],
  },
  {
    id: 18,
    slug: 'design-live-streaming',
    title: 'Design a Live Streaming Platform',
    difficulty: 'Hard',
    category: 'Real-time Systems',
    tags: ['live-streaming', 'rtmp', 'hls', 'cdn', 'latency'],
    problemStatement: `Design a live video streaming platform like Twitch. Streamers broadcast live video; viewers watch in near real-time with low latency. Target: 10M concurrent viewers, 100K concurrent streamers.`,
    requirements: {
      functional: ['Ingest live video stream from streamers', 'Transcode to multiple bitrates', 'Deliver to viewers with < 10s latency', 'Live chat alongside stream', 'Stream recording and VOD'],
      nonFunctional: ['< 10s glass-to-glass latency', '99.9% stream uptime', '10M concurrent viewers', 'Auto-scale transcoding'],
    },
    capacityEstimates: `100K streamers × 5Mbps = 500 Gbps ingest\n10M viewers × 3Mbps avg = 30 Tbps egress\nTranscoding: 100K streams × 4 variants = 400K parallel transcode jobs`,
    solutionBreakdown: [
      { section: 'API and Streamer Onboarding', content: 'Streamer flow: POST /streams { title, category } returns { stream_key, rtmp_url, hls_playback_url }. The stream_key is a single-use, regenerable secret bound to the channel; it goes into OBS. Viewer flow: GET /streams/{channel} returns the HLS manifest URL plus a short-lived playback token for paid or geo-fenced content. Chat: WebSocket /chat?channel=... with per-channel rooms.\n\nManifest URLs are signed (CloudFront-style) with a 15-minute TTL so playback cannot be hot-linked. Stream_keys rotate on revoke; if a streamer leaks one we kill the channel and force a new key without disrupting the viewer-facing channel slug.' },
      { section: 'Ingest Tier', content: 'Streamers push RTMP (or SRT, which adds packet loss recovery) to the nearest ingest POP via Anycast. Each POP runs an ingest server (nginx-rtmp, MediaLive, or in-house) that authenticates the stream_key, terminates the RTMP connection, demuxes audio/video, and writes raw frames into a per-stream segment buffer.\n\nIngest must be near the streamer for upload latency: a typical streamer has 5–20 Mbps upload and a tiny buffer. Cross-continent ingest costs 100–200 ms RTT and badly hurts the LL-HLS chunk-publish cadence. Capacity per POP: a single c6i.4xlarge can sustain ~500 simultaneous 1080p ingests with hardware-assisted decoding.' },
      { section: 'Transcoding Ladder', content: 'Per ingested stream we produce an ABR (adaptive bitrate) ladder: 1080p60 @ 6 Mbps, 720p60 @ 3.5 Mbps, 480p30 @ 1.5 Mbps, 360p30 @ 800 kbps, audio-only 96 kbps. Transcoders run on GPU instances (NVENC) — about 4 streams per A10 GPU, scheduled by a transcoder orchestrator.\n\nFor partner streamers we also publish the source ladder ("source quality"), bypassing transcode and saving GPU cost. We co-locate transcoders with ingest in the same POP so the segment never traverses the WAN before becoming an ABR ladder; only the encoded HLS chunks fan out to the CDN.' },
      { section: 'Segment and Manifest Format', content: 'fMP4 segments, 2-second target duration for standard HLS, 200 ms parts for Low-Latency HLS (LL-HLS). The manifest (.m3u8) is updated on every part; clients use HTTP/2 server push or CMAF chunked transfer to receive parts as they are produced.\n\nKey directories on CDN: /channel_id/source.m3u8 (master), /channel_id/720p.m3u8 (variant), /channel_id/720p/seg_N.m4s (chunks). Manifests are short (~30s sliding window for live, longer for "DVR" rewind). Old segments are tombstoned after a configurable VOD retention window.' },
      { section: 'CDN Delivery and Cache Strategy', content: 'Multi-CDN by default (CloudFront + Fastly + Akamai) routed by RUM-driven steering; one CDN going down should drop viewers for seconds, not minutes. Cache key includes manifest version and segment number; manifests have a 1-second TTL (revalidate often), segments have a long TTL (immutable once published).\n\nTarget cache-hit ratio: >99.5% on segments for popular streams (one viewer per region warms the edge for everyone). Cache fill from origin shielded by a mid-tier (CDN tiered cache) so origin sees one fetch per segment per CDN region, not per viewer.' },
      { section: 'Latency Modes and Trade-offs', content: 'Standard HLS: ~20–30s glass-to-glass because the player needs to buffer 3 segments of 6–10s each. LL-HLS: ~2–4s with 200 ms parts and HTTP/2 push. CMAF-LL with WebSocket signaling: ~1–2s. WebRTC SFU: sub-second but every viewer is a stateful UDP connection; cost scales linearly with viewers and a single SFU node tops out around 30k peers.\n\nProduct picks the mode per stream: LL-HLS for normal Twitch chat-along streams, WebRTC for interactive auctions/Q&A under 50k viewers. Switching modes mid-stream is hard; we typically commit at stream start.' },
      { section: 'Live Chat and Interactivity', content: 'Chat is a separate WebSocket service partitioned by channel_id. A chat server holds the WebSocket fanout for a slice of channels; messages enter, get authorized (slow mode, follower-only, banned terms), then publish to Redis pub/sub for the channel, which fans out to every connected viewer in tens of ms.\n\nFor very large channels (>500k concurrent viewers) we sample-fanout: each viewer sees a representative random subset of messages, not every single one — at scale the screen cannot render 10k msg/sec anyway. Moderation runs out-of-band: ML toxicity classifier, automated rules, plus human mods with delete/timeout commands; deletions propagate as tombstone messages and viewers re-render.' },
      { section: 'VOD and Clip Pipeline', content: 'Every live segment is mirrored to durable object storage as it is produced. When the stream ends, a VOD assembler stitches the segments into a single HLS playlist, generates thumbnails, and triggers an async transcode to mp4 for download. Clips (short user-generated highlights) are virtual playlists pointing to a [start_segment, end_segment] window — no re-encoding, instant publish.\n\nVOD cleanup: free tier streams retained 14 days, partner streams retained 60 days, clips kept indefinitely. A nightly GC job deletes expired segments from object storage and tombstones the VOD manifest.' },
      { section: 'Discovery and Catalog', content: 'A live catalog service indexes active streams by category, language, follower count, and tags. Search runs against an Elasticsearch index updated by stream-start/end events on the event bus. Home-page recommendations come from a model trained on watch history, computed offline and served per-user from a precomputed feed in Redis.\n\nThe catalog must scale to ~100k active streams with viewer counts changing every second. Viewer counts are not stored authoritatively in ES; they live in a separate Redis hash updated by the chat servers (since they hold the WebSocket connections) and merged into search results at query time.' },
      { section: 'DRM, Tokens, and Geofencing', content: 'Premium content uses Widevine/FairPlay/PlayReady DRM. Player fetches a license from a license server, which checks entitlements (subscription, geo) and returns a key under the DRM session. The HLS manifest carries EXT-X-KEY pointing to the license endpoint with a session-bound token.\n\nFor non-DRM streams, the manifest URL itself is signed with a short-lived token containing user_id, region, and expiry. Geo enforcement happens at CDN edge using the requester IP and the token claim — refusing to serve manifests outside allowed regions. Token forging is impossible without the signing key; replay is bounded by the 15-minute TTL.' },
      { section: 'Scaling and Capacity Planning', content: 'Ingest: scale POPs by streamer geography. Hot regions are NA, EU, BR, KR. Transcoders: GPU pool sized for the 95th-percentile concurrent ladder count (about 4 ladders/A10). CDN egress: dominant cost; 10 M viewers at 3 Mbps avg = 30 Tbps which at typical CDN pricing of $0.005/GB is roughly $13K/hour. Multi-CDN bidding and peering with major ISPs is how Netflix/Twitch keep this affordable.\n\nChat scales independently: connection servers handle ~100k WebSockets each; the Redis pub/sub fanout fabric handles ~5 M msgs/sec per cluster with sharding by channel_id.' },
      { section: 'Failure Modes and Resilience', content: 'Streamer Wi-Fi drops: SRT auto-recovers; with RTMP, OBS reconnects but stream goes through a brief stall, the player sees a manifest gap, falls back to lower bitrate. Transcoder GPU dies: orchestrator detects via missed heartbeats, reassigns the channel to a hot-spare GPU within 5s; viewer sees one missing segment. CDN POP failure: RUM steering shifts viewers to a healthy CDN within 30s; cache-fill latency causes a brief origin spike that the tiered cache absorbs.\n\nThe canonical hard case is an ingest-POP outage mid-stream: streamer reconnects to a different POP, gets a new ingest session, and the orchestrator stitches segments under the same channel_id so playback continues. The 2–4 seconds of stitching gap appears as a brief buffering in the player.' },
      { section: 'Observability and Quality Metrics', content: 'Player-side QoE metrics streamed back via beacon: rebuffer ratio (target <1%), startup latency (target <3s), bitrate switches per minute, video-frame-drop count. Streamer-side: ingest bitrate stability, dropped frames upstream, ladder render lag.\n\nServer-side: origin egress per channel, transcode latency per ladder, segment-publish jitter (LL-HLS depends on this being <100 ms). Alerts fire when rebuffer ratio rises above baseline in a region (often a CDN issue), when transcode queue depth grows (GPU saturation), and when ingest auth failure rate spikes (often a stream-key leak being exploited).' },
    ],
    diagram: `graph TB
    subgraph Clients
        Streamer[Streamer OBS]
        Viewer[Viewer Web]
        ViewerMobile[Viewer Mobile]
        ChatUser[Chat Viewer]
    end
    subgraph Edge
        IngestEdge[RTMP Ingest Edge]
        CDNEdge[CDN Edge LL-HLS]
        WSGateway[Chat WebSocket Gateway]
    end
    subgraph Gateway
        APIGW[API Gateway]
        Auth[Auth and Streamer Keys]
    end
    subgraph Services
        StreamMgr[Stream Manager]
        TranscodeOrch[Transcoder Orchestrator]
        ChatSvc[Chat Service]
        ModSvc[Chat Moderation]
        VODSvc[VOD Recorder]
        CatalogSvc[Live Catalog and Discovery]
        DRMSvc[Token and DRM Service]
        SubBilling[Subscription and Bits Svc]
    end
    subgraph Async
        TranscoderFarm[Transcoder Workers 160 to 1080p]
        ManifestUpd[Manifest Updater]
        ChatPubSub[Chat Redis Pub Sub]
        ModBot[Async Moderation Bot]
        ThumbGen[Thumbnail Generator]
    end
    subgraph Storage
        CDNOrigin[(CDN Origin Segments)]
        VODBlob[(VOD Archive S3)]
        StreamMeta[(Stream Metadata DB)]
        ChatHistory[(Chat History Cassandra)]
        UserDB[(User DB)]
        DRMTokens[(DRM Token Store)]
    end
    subgraph Analytics
        EventBus[Kafka Watch Events]
        Lake[(Data Lake)]
    end

    Streamer -->|RTMP push| IngestEdge --> StreamMgr --> StreamMeta
    StreamMgr --> TranscodeOrch --> TranscoderFarm --> CDNOrigin
    TranscoderFarm --> ManifestUpd --> CDNOrigin
    TranscoderFarm --> ThumbGen --> CDNOrigin
    CDNOrigin --> VODSvc --> VODBlob

    Viewer -->|browse live| APIGW --> CatalogSvc --> StreamMeta
    Viewer -->|play stream| APIGW --> DRMSvc --> DRMTokens
    Viewer -->|fetch manifest| CDNEdge
    ViewerMobile -->|partial segments LL-HLS| CDNEdge
    CDNEdge -->|origin miss| CDNOrigin

    ChatUser -->|chat msg| WSGateway --> ChatSvc
    ChatSvc --> ChatPubSub
    ChatPubSub -->|fanout| WSGateway --> Viewer
    ChatSvc --> ChatHistory
    ChatSvc --> ModSvc --> ModBot
    ModBot --> ChatSvc

    Viewer -->|cheer or sub| APIGW --> SubBilling --> UserDB

    Viewer -->|watch event| EventBus
    StreamMgr --> EventBus --> Lake

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class CDNOrigin,VODBlob,StreamMeta,ChatHistory,UserDB,DRMTokens storage
    class TranscoderFarm,ManifestUpd,ChatPubSub,ModBot,ThumbGen async
    class IngestEdge,CDNEdge,WSGateway edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'LL-HLS vs WebRTC for low-latency', rationale: 'LL-HLS achieves ~2–3s latency while keeping CDN economics; works at any viewer count because chunks ride a normal HTTP cache. WebRTC delivers sub-second latency but every viewer is a stateful peer connection; an SFU node holds ~30k peers and cost scales linearly with audience. Use LL-HLS for normal streaming; WebRTC only for genuinely interactive use cases under 50k viewers (sports betting, auctions).' },
      { decision: 'Per-region transcode vs centralized transcode', rationale: 'Per-region transcode co-locates GPUs with ingest, saving WAN egress on the transcode step and keeping segment-to-CDN latency low. Centralized is cheaper to operate (one GPU pool, simpler scheduling) but burns inter-region bandwidth for every ladder. The egress math wins for per-region above ~10k streamers; below that, centralized is simpler.' },
      { decision: 'Transcode ladder at ingest vs transmux only', rationale: 'Transcoding to a full 5-rung ladder costs ~4× the GPU per stream but lets viewers on cellular get a watchable bitrate. Transmux-only (pass through the streamer-sent bitrate) is cheap but punishes mobile viewers and inflates rebuffer ratios. Partners with stable connections often opt out of the ladder for their premium streams; the long tail must be transcoded.' },
      { decision: 'Multi-CDN vs single CDN', rationale: 'Multi-CDN gives outage resilience and bargaining power on per-GB pricing — at 30 Tbps egress, a 10% bid improvement is worth millions per month. The cost is integration complexity (auth tokens, signed-URL schemes, log formats differ) and the need for RUM-driven steering. Below ~1 Tbps egress, one CDN with a fallback is sufficient.' },
      { decision: 'Chat history persistence vs ephemeral chat', rationale: 'Persisting chat into Cassandra/HBase enables replay alongside VOD playback and is useful for moderation evidence, but at 10s of thousands of msg/sec on popular streams it is a real write load. Ephemeral chat (Redis-only, dropped at end of stream) is cheaper but loses the engagement of "re-watching the moment." Most platforms persist for a bounded retention (30 days) — a workable middle ground.' },
    ],
    keyTakeaways: [
      'LL-HLS plus CDN tiered caches is the practical baseline for scaling live video to millions of concurrent viewers',
      'Egress, not compute, is the dominant cost — multi-CDN bidding and ISP peering are where you save real money',
      'Ingest and transcode must be co-located in the same region to keep glass-to-glass latency sane',
      'Chat is an entirely separate scaling axis from video — partition by channel and use sample-fanout for huge audiences',
      'VOD and clips reuse the live segments as immutable artifacts; manifests are virtual playlists, not re-encoded files',
      'The streamer is the single point of fragility — auto-reconnect, ingest failover, and per-POP stickiness matter more than any clever player trick',
    ],
    faqs: [
      { question: 'What actually causes the 20-second latency of standard HLS, and what does LL-HLS change?', answer: 'Standard HLS uses 6–10 second segments and the player buffers three of them before playback to absorb jitter — that is 18–30 seconds right there. LL-HLS chops each segment into ~200 ms parts and publishes the part to the CDN as soon as it is encoded, advertised in the manifest with EXT-X-PART. The player can start playing within one segment instead of three. End-to-end you go from ~25s to ~3s without giving up the HTTP/CDN substrate that makes HLS scale. WebRTC goes lower (<1s) but pays the price in connection-state cost per viewer.' },
      { question: 'Why is multi-CDN basically mandatory at this scale?', answer: 'Two reasons. First, single CDN outages happen — Fastly took down half the web for 49 minutes in June 2021 — and a live-streaming product cannot eat that. Second, at 30 Tbps you negotiate per-GB rates against the CDNs and the leverage comes from being able to shift traffic. RUM-driven steering measures actual viewer QoE per CDN per region and routes; if Akamai is slow in São Paulo today, viewers move to Fastly. You pay the cost of three integrations and three sets of signed-URL schemes for both insurance and pricing leverage.' },
      { question: 'How do you keep popular-stream cost manageable when a million people watch the same content?', answer: 'CDN cache hit ratio. A single segment fetched from origin and served from a regional CDN edge to 100k viewers costs you the egress to the edge once, not 100k times. Tiered caches (CDN shield) make this even better: edge POPs in the same region share a mid-tier, so origin sees one request per segment per CDN region, not per POP. For very popular streams you can pre-warm the edges by pushing the manifest to the CDN as soon as the stream starts — no cold-cache penalty for the first viewer.' },
      { question: 'What is the difference between live latency and "glass-to-glass" latency and which one matters?', answer: 'Glass-to-glass = streamer\'s camera capture to viewer\'s screen, the full pipeline. That is what users feel during interactive moments (chat reaction to a streamer doing something). Live latency in some specs refers to manifest publish to player render, ignoring ingest/encode. Always be explicit which you mean. Twitch-style chat-along streams need glass-to-glass <5s; interactive auctions need <1s; broadcast-mode esports tolerates 15s with chat sync to the same delay.' },
      { question: 'How do you handle a streamer who switches Wi-Fi mid-stream?', answer: 'OBS detects the disconnect and reconnects via RTMP within seconds; SRT (which we prefer for unstable links) handles packet loss recovery natively and may not disconnect at all. Ingest assigns the same channel_id to the new connection so the transcoder pipeline keeps running. The viewer sees a 2–5 second freeze and may step down to a lower bitrate via ABR; very few drop out. The hard case is an OBS crash with no auto-restart — that ends the channel and viewers fall off after a 30s grace period.' },
      { question: 'Why not just use WebRTC for everything if it gives sub-second latency?', answer: 'Because every viewer is a UDP connection to an SFU (Selective Forwarding Unit), and each SFU node tops out around 30k viewers depending on bitrate. A million-viewer stream needs 30+ SFU nodes connected in a relay tree, with all the failure modes that implies. WebRTC also has poor browser cache reuse — every viewer is independent, vs HLS where one fetched segment serves everyone behind a cache. The cost is roughly 10–100x HLS for the same audience. Use WebRTC when you genuinely need sub-second back-channel; otherwise LL-HLS.' },
      { question: 'How does the chat stay synchronized with the video when the video has a few seconds of buffer?', answer: 'It does not, perfectly. Chat travels over a WebSocket with ~100 ms latency end-to-end, while video sits behind a 2–5s LL-HLS buffer. So chat is always slightly ahead of video. Most platforms accept this; some offer "synced chat" mode that delays chat fanout by the player\'s reported live edge. Synced chat costs an extra round-trip and complicates moderation (a banned message may render after the user already saw it); few platforms enable it by default.' },
      { question: 'What happens to a stream when a transcoder GPU crashes?', answer: 'The transcoder orchestrator tracks heartbeats per stream-assigned-GPU. On missed heartbeat (>5s) it migrates the channel to a hot-spare GPU; the orchestrator hands over the codec state if possible (some encoders support snapshot/restore) or starts fresh. The viewer sees one missing segment, the ABR ladder briefly drops to whatever rungs are alive, and then full quality resumes. Persistent failures (>30s) get the stream marked degraded and viewers may see lower bitrates. The streamer is notified via the dashboard.' },
      { question: 'How do clips work without re-encoding the original stream?', answer: 'A clip is just a [start_segment, end_segment] reference plus a clip manifest that includes only those segments. Because segments are immutable and stored in object storage, the clip "exists" the instant the metadata is written — no encoding, no copy. Playback fetches the same segments the live viewers got. Downloads (MP4) are produced async by stitching the segments and remuxing; that does take a transcoder cycle but happens out of band.' },
      { question: 'How would you build a fast-scrollable "recommended live channels" feed?', answer: 'Maintain a per-user precomputed feed in Redis, ranked offline by a model that scored every active stream against the user\'s watch history. Updated on every channel transition (stream start/end, follower change). Serving is a single Redis ZREVRANGE per user. Real-time signals (a streamer the user follows just went live) bypass the cached feed and pin to the top via a small live boost layer. The actual viewer counts displayed come from the chat-server Redis hash, merged into the response at request time so they are real-time.' },
    ],
  },
  {
    id: 19,
    slug: 'design-web-crawler',
    title: 'Design a Web Crawler',
    difficulty: 'Medium',
    category: 'Distributed Systems',
    tags: ['crawler', 'bfs', 'politeness', 'bloom-filter', 'distributed'],
    problemStatement: `Design a scalable web crawler that can index billions of web pages. The crawler must respect robots.txt, avoid duplicate URLs, handle politeness delays, and run continuously to keep the index fresh.`,
    requirements: {
      functional: ['Crawl web pages starting from a seed URL list', 'Extract and follow links from each page', 'Respect robots.txt per domain', 'Store page content for indexing', 'Avoid re-crawling the same URL too frequently'],
      nonFunctional: ['Crawl 1B pages/month ≈ 400 pages/sec', 'Distributed across many crawler nodes', 'URL deduplication at scale', 'Politeness: max 1 req/sec per domain'],
    },
    capacityEstimates: `400 pages/sec × 100KB avg = 40MB/sec storage\n1B pages × 100KB = 100TB raw HTML storage\nURL frontier: 10B URLs × 64B each = 640GB`,
    solutionBreakdown: [
      { section: 'Control API and Crawl Jobs', content: 'A small control plane lets operators submit work: POST /crawl_jobs { seeds[], crawl_depth, domain_allowlist?, priority } returns a job_id. GET /crawl_jobs/{id} returns counters (pages fetched, bytes stored, error rates). The crawl itself is continuous — there is no end of crawl, only a steady state of fetching and revisiting.\n\nInternally, every URL in the frontier carries the originating job_id so we can attribute usage and isolate noisy jobs. The control plane also exposes pause/resume per job and per domain; politeness enforcement reads these flags before each fetch.' },
      { section: 'URL Frontier Data Structure', content: 'The frontier is two layers: a front queue per priority level and a back queue per domain. URLs land in the front queue ordered by score (PageRank-estimate × freshness boost × per-job weight). A scheduler thread pops from front queues and routes the URL to the back queue keyed by domain.\n\nBack queues are sized 1 per domain. A separate worker pool drains back queues, but a back queue only releases a URL when its per-domain token bucket has a token (typically 1/sec). This decouples global priority (front) from per-domain politeness (back) and is the Mercator-style design Google still uses in principle.' },
      { section: 'URL Deduplication at Scale', content: 'Three layers of dedup. (1) Per-worker LRU of the last 100K URLs, instant rejection of repeats inside a single batch. (2) A shared Bloom filter sized for 10B URLs at 0.1% false positive rate (~14 bits/URL, ~17GB total, sharded across Redis). (3) A persistent seen-URLs set in Cassandra partitioned by URL hash for the rare Bloom-filter false positives.\n\nLookup flow: hit LRU → hit Bloom → on Bloom positive, query Cassandra to confirm. Bloom alone is not safe (a false positive would lose a URL forever); Bloom + Cassandra confirms keeps recall at 100%. Bloom filter is rebuilt weekly from Cassandra to compact deletions and avoid saturation.' },
      { section: 'Fetcher Workers and Egress', content: 'Stateless workers pull from back queues. Each fetch: resolve DNS (locally cached, ~2s TTL only because hot domains rotate IPs), open TCP, GET with browser-mimicking User-Agent (clearly identified as our crawler, with operator email per RFC 9309), accept gzip/brotli, cap response at 5 MB. Latency target p50 ~500ms, p99 ~3s; hard timeout 10s.\n\nEgress goes through a NAT pool of thousands of IPs so a single domain does not see all traffic from one IP and rate-limit us. Workers report fetch outcome (status code, bytes, latency, content-type) into the metrics bus on every attempt.' },
      { section: 'Politeness, robots.txt, and Ethics', content: 'Before fetching any URL on a new domain, fetch /robots.txt and cache for 24h. Parse Disallow rules and respect them — never crawl a disallowed path. Honor Crawl-delay (default 1s if unspecified) via the per-domain token bucket. Honor Retry-After on 429/503 by suspending the back queue for the indicated duration.\n\nWe also self-impose limits beyond robots.txt: max 1 req/sec per domain for small sites, scale up to ~5 req/sec for the largest, never burst above ~10 even if the site permits it. Identify ourselves: User-Agent string contains a contact URL where webmasters can request exclusion. Failures to identify cause real-world legal and operational pain.' },
      { section: 'Parsing, Link Extraction, and Normalization', content: 'After fetch, the HTML parser (Jsoup, Lexbor, or AngleSharp) extracts links (a[href], canonical, sitemap, link rel=next). URLs are normalized: lowercase host, canonicalize scheme, remove default ports, sort query parameters, strip fragments, drop session-id-like params via a known blacklist. Without normalization the frontier explodes with /?utm=a, /?utm=b duplicates.\n\nFor JavaScript-rendered sites, a subset of workers run a headless browser pool (Puppeteer/Playwright). This costs ~50x compute per page so it is reserved for high-PageRank domains or sites that fail static parsing. Cheap heuristic: if the static HTML has <100 visible characters and lots of script tags, route to headless.' },
      { section: 'Content Store and Near-Duplicate Detection', content: 'Raw HTML stored in object storage (S3) under content_hash/year/month/url_hash.gz. WARC format is the archival standard if we care about preserving headers + body together. A content_hash (SHA-256) gives exact-duplicate detection cheaply.\n\nNear-duplicates (templates, ad insertions, near-identical mirrors) need SimHash or MinHash. We compute a 64-bit SimHash of the visible text and store it per page; pages within Hamming distance 3 are considered duplicates. The downstream indexer can then drop ~30% of crawled pages as near-dupes of higher-ranked pages, saving index size.' },
      { section: 'Recrawl Strategy and Freshness', content: 'A re-crawl scheduler keeps the index fresh. Per-URL adaptive recrawl interval: a news site\'s homepage may be revisited every 5 minutes, a static documentation page every 30 days. Initial interval is based on observed change rate; if HTTP If-Modified-Since returns 304 a few times in a row, the interval doubles; on a real change it halves.\n\nWe track a per-URL change_score over time. High-score pages dominate the recrawl budget. This is the difference between a Mercator-style crawler and a naive BFS: at the same fetch budget, you get vastly better index freshness for the URLs users actually care about.' },
      { section: 'Distributed Crawler Architecture and Sharding', content: 'Frontier and Bloom filter shard by hash of registered domain (not host) so all subdomains of bbc.co.uk land on the same shard and share politeness state. Worker pools are stateless and pull from any shard; the per-domain back queue lives on the shard so the politeness token bucket is local.\n\nCapacity: at 400 pages/sec target, ~50 fetcher VMs each handling ~10 concurrent connections covers the workload; the bottleneck is rarely CPU, it is the long tail of slow domains. Parser workers scale separately because they are CPU-bound; we typically have 2x parser workers per fetcher worker.' },
      { section: 'Failure Modes and Recovery', content: 'Worker dies mid-fetch: the back queue gets a configurable retry (up to 3) with exponential backoff before giving up and writing a dead URL row. Frontier Kafka partition loss: replicas cover, but in-flight URLs may be re-emitted; the LRU + Bloom dedup absorbs the duplicates. Bloom filter false positive: Cassandra confirmation rescues; if Cassandra is also lying due to a write loss, we may miss a URL — acceptable at this scale.\n\nThe hard case is a misbehaving domain (broken HTTP, infinite redirects, tarpit pages). Per-domain error rate above 20% in a 5-minute window triggers automatic suspension; an alert tells the operator to investigate. We never let one bad domain DoS our worker pool.' },
      { section: 'Spam, Traps, and Adversarial Pages', content: 'The open web is hostile. Spider traps: dynamically generated infinite URL spaces (calendar pages with prev/next forever) — we cap per-domain URL count per crawl epoch. Hidden redirect chains to malware: follow at most 5 redirects then drop. Cloaking (serving different content to crawlers than browsers): occasionally re-fetch with a normal browser User-Agent to detect drift; flag domains for review.\n\nDomain-rank scoring suppresses spammy domains in the frontier priority so they get fewer fetches over time. Pages that are 90% boilerplate (template + ads) get downweighted in PageRank computation downstream.' },
      { section: 'Observability and SLOs', content: 'Per-domain dashboards: fetch rate, error rate, average page size, robots.txt compliance. Global: pages/sec, frontier depth, Bloom filter saturation, parse failure rate, storage growth rate. Alerts on frontier depth growing unboundedly (we are falling behind), parse failure rate spike (HTML parser broken), robots.txt fetch failure rate spike (something at the egress layer).\n\nAn SLO worth defining: 95% of URLs in the highest priority tier should be re-fetched within their target interval. Missing this SLO means freshness is degrading — the symptom users see as "stale results in search."' },
    ],
    diagram: `graph TB
    subgraph Clients
        Seeds[Seed URL List]
        Sitemap[Sitemap Submitter]
        Web[Public Web]
    end
    subgraph Edge
        DNSCache[DNS Resolver Cache]
        FetcherEgress[Egress Pool Many IPs]
    end
    subgraph Gateway
        SchedAPI[Crawl Control API]
    end
    subgraph Services
        FrontierMgr[Frontier Manager]
        Politeness[Politeness Token Bucket]
        RobotsSvc[Robots.txt Service]
        Fetcher[HTTP Fetcher Workers]
        Parser[HTML Parser and Link Extractor]
        Dedup[URL Dedup Bloom and Set]
        SimHashSvc[SimHash Near Dup Detector]
        PRankSvc[PageRank Estimator]
        IndexFeeder[Indexing Pipeline Feeder]
    end
    subgraph Async
        FrontierQ[URL Frontier Kafka]
        DomainQ[Per Domain Queue Redis]
        ContentQ[Parsed Content Topic]
        RecrawlSched[Recrawl Scheduler]
    end
    subgraph Storage
        BloomStore[(Bloom Filter)]
        SeenSet[(Seen URLs Cassandra)]
        RobotsCache[(Robots Cache Redis)]
        RawHTML[(Raw HTML S3)]
        FingerprintDB[(SimHash DB)]
        DomainPRank[(Domain PageRank Store)]
    end
    subgraph Analytics
        EventBus[Crawl Metrics Bus]
        Lake[(Data Lake)]
    end

    Seeds --> SchedAPI --> FrontierMgr --> FrontierQ
    Sitemap --> SchedAPI

    FrontierQ --> DomainQ --> Fetcher
    Fetcher --> Politeness
    Fetcher --> RobotsSvc --> RobotsCache
    Fetcher --> DNSCache
    Fetcher --> FetcherEgress
    FetcherEgress -->|GET page| Web --> Fetcher

    Fetcher -->|store| RawHTML
    Fetcher --> Parser
    Parser --> ContentQ --> IndexFeeder
    Parser --> SimHashSvc --> FingerprintDB

    Parser -->|extract links| Dedup
    Dedup --> BloomStore
    Dedup --> SeenSet
    Dedup -->|new URLs| FrontierMgr

    PRankSvc --> DomainPRank --> FrontierMgr
    RecrawlSched --> FrontierQ

    Fetcher --> EventBus --> Lake

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class BloomStore,SeenSet,RobotsCache,RawHTML,FingerprintDB,DomainPRank storage
    class FrontierQ,DomainQ,ContentQ,RecrawlSched async
    class DNSCache,FetcherEgress edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'BFS frontier vs priority frontier', rationale: 'BFS is dead simple and gives uniform coverage but spends most of its budget on the long tail of low-value pages. Priority crawl (PageRank-estimate × freshness) concentrates the budget on pages users care about and produces measurably better search relevance per dollar. Above ~1B URLs the priority queue overhead becomes real but is still net positive.' },
      { decision: 'Bloom filter alone vs Bloom + Cassandra confirm', rationale: 'Bloom alone is small and fast but false positives mean permanently missed URLs — over time the index has holes. Bloom + Cassandra confirm catches false positives and keeps recall at 100% at the cost of one Cassandra lookup per positive hit. At our false-positive rate (~0.1%) this only happens for 1 in 1000 checks, so the cost is negligible.' },
      { decision: 'Headless browser for JS rendering vs static parsing only', rationale: 'Static parsing covers ~80% of the web and costs ~10ms per page. Headless browser covers the remaining 20% (SPAs, Angular/React apps) but costs ~500ms and 50x the memory. The right answer is hybrid: route to headless only when the static parse yields nothing interesting, and only for high-PageRank domains where the cost is justified.' },
      { decision: 'Crawl from one cloud region vs distributed globally', rationale: 'One region is operationally simple but penalizes latency to remote domains and concentrates load on one egress IP range, increasing the chance of broad blocklisting. Globally distributed crawlers reduce per-fetch RTT and spread egress across many IP ranges but require synchronizing the dedup state across regions (Bloom and Cassandra). For >100M pages crawled, distributed wins; below that, one region is fine.' },
      { decision: 'Aggressive politeness vs maximum throughput', rationale: 'Aggressive (1 req/sec/domain) is universally accepted, never gets us blocked, and keeps the operator inbox quiet. Maximum throughput (parallel connections to one host) finishes faster but invites IP bans, captchas, and abuse reports. The cost of an abuse report can be hours of operator time; the benefit of bursting is a couple of percent faster total crawl. Politeness wins by a wide margin for any long-running operation.' },
    ],
    keyTakeaways: [
      'The frontier is two-layer (priority front + per-domain back) so global priority and per-domain politeness can coexist without lock contention',
      'Bloom filter plus Cassandra confirm gives O(1) average-case dedup at 100% recall — neither alone is sufficient',
      'URL normalization is the unglamorous step that determines whether your frontier explodes — invest in it before scaling out',
      'Adaptive recrawl, not uniform recrawl, is what keeps freshness up at fixed budget',
      'Per-domain politeness state must live where the back queue lives — sharding by registered domain (not host) keeps subdomains coordinated',
      'The crawler must self-throttle and identify itself; operating on the open web is a social contract enforced by reputation',
    ],
    faqs: [
      { question: 'What goes wrong if you skip URL normalization?', answer: 'Your frontier explodes with permutations of the same logical page. example.com/article?id=5&utm=a, example.com/article?id=5&utm=b, example.com/article?id=5#section all hash differently but resolve to the same content. Without normalization you waste your fetch budget on duplicates, dedup pressure goes up, and the index ends up with near-duplicate documents that confuse ranking. The normalizer also drops common session/tracking params (utm_*, fbclid, gclid) which are responsible for most of the bloat.' },
      { question: 'How does the crawler enforce 1 req/sec per domain when workers are distributed?', answer: 'Per-domain politeness state lives on the shard that owns the domain. A back queue per domain holds the next-ready URL and an associated token bucket; the bucket refills at the per-domain rate. Any worker pulling from the shard must request a URL from the back queue, which atomically debits a token or returns nothing. Because all back queues for a domain live on one shard, there is no cross-shard coordination — politeness is enforced by data placement, not by a lock.' },
      { question: 'What is the actual storage cost for a 1-billion-page crawl?', answer: 'Raw HTML ~100 KB avg gzipped to ~30 KB, so 30 TB compressed. Add ~30% for headers and WARC overhead = ~40 TB. Bloom filter ~17 GB. Cassandra seen-URLs at ~50 bytes per row = ~50 GB. Frontier Kafka topic with retention sized for ~24h of in-flight URLs = ~few hundred GB. Object storage is by far the dominant cost: roughly $1,000/month for 40 TB in S3 standard, cheaper if you can use S3 IA for older snapshots.' },
      { question: 'How do you handle a domain that returns identical content from many URLs (like example.com/page/123 redirecting to example.com/p/123)?', answer: 'Two mechanisms. First, canonical-URL hint: most reputable sites set rel=canonical in the HTML; we honor it by recording the canonical as the dedup key. Second, content fingerprinting: SimHash the visible text and treat pages within Hamming distance 3 as duplicates of an earlier-seen URL. The first-seen URL becomes the representative; subsequent duplicates are recorded as aliases but do not re-enter the index. This is also how we handle mirror sites.' },
      { question: 'What does "respect robots.txt" actually mean in practice?', answer: 'Fetch /robots.txt before any other URL on the host, parse it for User-Agent matching our identifier (or the wildcard), apply Disallow rules to every URL on that host, honor Crawl-delay, and refresh the cached robots.txt every 24 hours. We also honor Allow rules within a Disallow scope. Sitemap directives in robots.txt are crawled to discover new URLs. Disallowed URLs never make it past the frontier — they fail the politeness check on enqueue, not at fetch time, so we do not even resolve their DNS.' },
      { question: 'How do you avoid spider traps (dynamically generated infinite URL spaces)?', answer: 'Three defenses. Per-host URL cap per crawl epoch (e.g., no more than 100k URLs from any one host per day for typical sites; partner sites can be allowlisted higher). Pattern detection: if /page=N URLs keep yielding similar content, downweight further /page=N+1 enqueues. Depth cap from the seed URL: typical 10–15 links deep, beyond which we assume the page is too obscure to matter. A persistent calendar trap (prev/next forever) shows up in metrics as a single domain consuming an outsized fetch share, which the per-host cap catches automatically.' },
      { question: 'Why use Cassandra for the seen-URLs set instead of a relational DB or just S3?', answer: 'Workload is enormous-volume point lookups (the Bloom-positive confirmation) and append-only writes. Cassandra partitions cleanly by URL hash, scales horizontally without coordination, and handles ~10B rows trivially. Relational DBs choke on the write volume and would need heroic sharding. S3 has no point-lookup latency story (every check would be a GET; minimum cost is ~10ms per check). Cassandra hits ~1ms p99 at this access pattern.' },
      { question: 'How does the crawler decide which URLs to revisit and how often?', answer: 'Per-URL adaptive interval. Start at 1 day for new URLs. On each revisit, compare the new content hash to the last one. If unchanged, double the interval (capped at 30 days for normal pages, 90 for static). If changed, halve the interval (floor at 5 min for news, hours for normal sites). Layer a domain-class multiplier: news domains start faster, software docs slower. The result is that under a fixed fetch budget, the highly volatile pages dominate the revisit traffic — which is exactly what an end-user search engine needs.' },
      { question: 'What happens if a site blocks our IP range and serves all 403s?', answer: 'The error rate per domain spike triggers automatic suspension of that domain in the frontier; the operator is paged. We investigate: usually the site updated their bot detection or our User-Agent string is being treated as adversarial. We can rotate egress IPs from the NAT pool, contact the site owner if the volume justifies it, or accept the block and continue. We never try to defeat the block by faking a regular-browser User-Agent — that is what gets crawlers sued.' },
      { question: 'How does the crawler integrate with a downstream search index without becoming the bottleneck?', answer: 'Decouple via Kafka. Crawler writes a "parsed page" event to a Kafka topic; indexers read from the topic at their own pace. Crawler does not care if indexing is keeping up because the content is also written to S3 — the worst case is a slow indexer, not a stuck crawler. Back-pressure flows in only one direction: if S3 writes start failing, the crawler slows; if the indexer falls behind, only freshness degrades. This separation lets us scale crawling and indexing independently.' },
    ],
  },
  {
    id: 20,
    slug: 'design-distributed-id-generator',
    title: 'Design a Distributed ID Generator',
    difficulty: 'Medium',
    category: 'Distributed Systems',
    tags: ['snowflake', 'uuid', 'distributed', 'monotonic', 'timestamp'],
    problemStatement: `Design a service that generates globally unique, time-sortable IDs at high throughput across multiple data centers. IDs should be 64-bit integers (fits in a long), and generation should require no coordination between nodes. Inspired by Twitter's Snowflake.`,
    requirements: {
      functional: ['Generate globally unique 64-bit IDs', 'IDs must be roughly time-sortable', 'No single point of failure', 'High throughput: 10M IDs/sec'],
      nonFunctional: ['< 1ms generation latency', 'No coordination needed per ID', 'Survive network partitions', 'IDs never repeat, even across restarts'],
    },
    capacityEstimates: `10M IDs/sec across 1,024 worker nodes = 9,765 IDs/sec/node\nSnowflake sequence bits (12): max 4,096 IDs/ms/node\n4,096 × 1,000 = 4M IDs/sec/node — well within limits`,
    solutionBreakdown: [
      { section: 'API and SDK Surface', content: 'Two patterns. Inline: a thin SDK linked into each calling service generates IDs locally after the worker has bootstrapped its machine_id. Hot path is zero network calls; the SDK calls long nextId() with no arguments. Remote: a small fleet of ID Generator nodes behind a load balancer answers POST /next?n=K returning K IDs in one round trip — used by JVMs that cannot trust their own clock, or by short-lived batch jobs.\n\nThe SDK exposes optional extractors: extractTimestamp(id), extractMachineId(id), extractSequence(id). These are 1-line bitshifts, useful for debugging and for ordering rows by creation time without a separate column.' },
      { section: 'Snowflake Bit Layout', content: '64-bit layout: 1 sign bit (always 0, keeps IDs positive in signed languages) | 41 timestamp bits (ms since custom epoch) | 10 machine bits (5 datacenter + 5 worker, allowing 32 DCs × 32 workers = 1024 nodes) | 12 sequence bits (4096 IDs per node per millisecond).\n\nLayout choices are not arbitrary. Putting the timestamp as the high-order bits guarantees rough time-sort. 12 bits of sequence is the smallest that supports 4M IDs/sec/node — enough for any single calling service. 10 machine bits caps the fleet at 1024 nodes; for larger fleets we either widen the machine field (Sony Sonyflake uses 16) or move to a different layout (Discord/Instagram variants).' },
      { section: 'Custom Epoch Choice', content: 'Use a custom epoch (e.g., 2020-01-01) rather than Unix epoch 1970. This buys you another ~50 years of headroom because the 41-bit timestamp counts from then, not 1970 — 2^41 ms ≈ 69 years from epoch. Standard Unix-epoch Snowflake started overflowing for very-early adopters around 2080; custom epoch pushes that to ~2089.\n\nThe epoch must be a constant across the fleet, stored in config and never changed. Changing it would shift the timestamp meaning and break any existing extractTimestamp() callers; an audit log of the epoch value is a sane safety measure.' },
      { section: 'Machine ID Allocation', content: 'Each worker, on startup, calls a bootstrap service backed by ZooKeeper or etcd. The bootstrap creates an ephemeral sequential znode under /idgen/workers; the znode\'s sequence number is the worker_id (0–1023). On worker crash, the znode disappears and the ID is reusable after a safety quarantine (~2× the max-clock-skew tolerance — typically 5 min) so an old worker cannot race with a new one for the same ID.\n\nDC_id is fixed per data center via static config. Worker_id is dynamic per process. This pattern handles fleet churn (auto-scaling) without operator intervention.' },
      { section: 'Sequence Counter and Overflow', content: 'A 12-bit per-millisecond counter, initialized to 0 at every new millisecond. Increment inside a single tick. If the counter would overflow (>4095 IDs in 1 ms), spin-wait for the next millisecond before issuing. Spin-wait is sub-millisecond and only triggers if a single node bursts above 4 M IDs/sec.\n\nWe randomize the starting sequence each millisecond by 0–15 to avoid a pathology where adjacent IDs always end in the same low bits — useful for downstream consumers that bucket by low bits (e.g., low-cardinality sharding).' },
      { section: 'Clock Skew, NTP, and Time Source', content: 'The hard correctness invariant is monotonic timestamps within a worker. NTP can step the clock backwards (typically by a few ms on resync); we detect this by comparing System.currentTimeMillis() to the last issued ID\'s timestamp and refusing to issue (or pausing) if time has regressed. PTP gives sub-microsecond accuracy in data centers but is not universally deployed; chrony with PPS is the practical default.\n\nMetric: clock_skew_jumps_per_minute. Alert at any non-zero value during steady state. Use clock_gettime(CLOCK_MONOTONIC) for elapsed time within a process, but use wall clock for the ID itself because we want extractable timestamps to mean real-world time.' },
      { section: 'Coordination-Free Generation Hot Path', content: 'Once a worker has its machine_id, the hot path is fully local: read wall-clock ms, compare to last-issued ms, either roll over the sequence (new ms) or increment it (same ms), compose the 64 bits, return. ~50ns on modern CPUs. Throughput per node: 4 M IDs/sec from the sequence bits, in practice limited by caller serialization to maybe 1–2 M/sec.\n\nThe only network calls happen once per process lifetime: bootstrap for machine_id, NTP sync. Per-ID coordination is zero. This is what makes Snowflake the right choice for high-throughput systems.' },
      { section: 'Failure Modes and Recovery', content: 'Process restart: re-acquires machine_id (may be a fresh one, due to znode quarantine). No risk of duplicate because the quarantine prevents reuse before any in-flight previous-worker IDs could have been observed. ZooKeeper outage on startup: the worker cannot start; falls back to a static reserved_ids config (each service keeps a few emergency machine_ids in config for cluster-wide ZooKeeper failures).\n\nClock jumps forward by hours: IDs become valid but extracted timestamps are wrong. Detection: a monotonic check against a peer node. Resolution: alert; fix the clock. Clock jumps backward: refuse to issue until time catches up, alert. Network partition: irrelevant — generation is local.' },
      { section: 'Alternative Schemes and Variants', content: 'Sonyflake: 16-bit machine_id, 8-bit sequence, 39-bit ts (10-ms units). Better for huge fleets, worse throughput per node. Discord: 22-bit worker_id, 10-bit increment, custom_epoch in 2015. Instagram: shorter machine_id, longer sequence. ULID/KSUID: 128-bit, time-sortable, no coordination, slightly larger payload. UUIDv7: standardizes time-sortable UUIDs; native PostgreSQL 18 support.\n\nFor most new systems in 2024 the call is Snowflake-variant (if a coordinator exists) or UUIDv7 (if you really want to avoid one). Both give you indexable, sortable, no-bottleneck IDs.' },
      { section: 'Persistence, Audit, and Recovery State', content: 'Workers do not persist any per-ID state. They persist last_emitted_timestamp_ms to a small local file (or shared volume) every 100ms — used on restart to refuse issuing IDs with timestamps ≤ that value, which guards against a backwards clock jump that survives a restart.\n\nMetadata that does persist: the machine_id assignment table in ZooKeeper, the custom epoch in config, the audit log of every machine_id allocation/release. The audit log is small (only a few events per worker per day) but invaluable for post-mortems.' },
      { section: 'Multi-Region and Datacenter Behavior', content: 'DC_id is the high 5 bits of the machine field, so IDs from different DCs naturally namespace into disjoint ranges; cross-DC duplicates are structurally impossible. Replication of the machine_id allocator across DCs is one-way: each DC has its own ZooKeeper cluster, allocating worker_ids 0–31 within its own DC_id.\n\nClock sync across DCs uses common NTP/PTP sources but small skew across continents (~1ms) is acceptable because the high-order timestamp bits provide rough sort, not perfect cross-DC monotonicity. Apps should treat IDs as roughly time-sorted, not strictly.' },
      { section: 'Observability and Operational Metrics', content: 'Per-worker metrics: ids_per_sec, sequence_overflow_count (spin-wait events; should be near zero unless throttled callers), clock_skew_ms, time_to_next_ms_in_overflow. Per-fleet: machine_id_allocator_qps, znode_count, quarantine_count.\n\nAlerts: clock_skew jump (any), sequence overflow rate > 10/min (a hot caller is hammering one node), machine_id_release without orderly shutdown (suggests a crash). The system is so simple in steady state that any nonzero alert is interesting; do not waste your pager budget on noise.' },
      { section: 'Trade-offs vs Database Auto-Increment', content: 'Postgres BIGSERIAL or MySQL AUTO_INCREMENT gives perfect monotonicity at the cost of a centralized counter — every INSERT hits the same row. Throughput tops out at low tens of thousands per second; cross-region writes need a single primary. Snowflake is decentralized and scales linearly with nodes but only guarantees rough time-sort, not strict monotonicity within a millisecond across the fleet.\n\nThe usual answer: use the database\'s ID for the primary key only if you are single-region and traffic is low. Once you go multi-region or pass tens of thousands of writes/sec, switch to Snowflake (or UUIDv7) and never look back.' },
    ],
    diagram: `graph TB
    subgraph Clients
        TweetSvc[Tweet Service]
        OrderSvc[Order Service]
        PaymentSvc[Payment Service]
        BatchJob[Batch Job]
    end
    subgraph Gateway
        SDK[ID Generator SDK]
        LB[Load Balancer]
    end
    subgraph Services
        IDGen1[ID Generator Node 1]
        IDGen2[ID Generator Node 2]
        IDGen3[ID Generator Node N]
        Composer[Bit Composer 41 ts 10 machine 12 seq]
        ClockGuard[Clock Skew Detector]
        SeqCounter[Per ms Sequence Counter]
        BootstrapSvc[Machine ID Bootstrap]
    end
    subgraph Async
        AlertJob[Clock Skew Alert]
        NTPSync[NTP Sync Daemon]
        MetricsAgg[Throughput Metrics]
    end
    subgraph Storage
        ZK[(ZooKeeper Machine ID Registry)]
        EpochCfg[(Custom Epoch Config)]
        SkewLog[(Skew Event Log)]
    end
    subgraph Analytics
        EventBus[Metrics Bus]
        Dash[Grafana Dashboards]
    end

    TweetSvc --> SDK
    OrderSvc --> SDK
    PaymentSvc --> SDK
    BatchJob -->|bulk allocate| SDK

    SDK --> LB
    LB --> IDGen1
    LB --> IDGen2
    LB --> IDGen3

    IDGen1 --> BootstrapSvc --> ZK
    IDGen2 --> BootstrapSvc
    IDGen3 --> BootstrapSvc

    IDGen1 --> ClockGuard --> NTPSync
    IDGen1 --> Composer --> SeqCounter
    Composer --> EpochCfg

    ClockGuard -->|backwards| AlertJob --> SkewLog
    AlertJob --> EventBus --> Dash
    IDGen1 --> MetricsAgg --> EventBus

    Composer -->|64-bit Snowflake ID| SDK
    SDK --> TweetSvc

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class ZK,EpochCfg,SkewLog storage
    class AlertJob,NTPSync,MetricsAgg async
    class LB edge
    class EventBus,Dash analytics`,
    tradeoffs: [
      { decision: 'Snowflake vs UUIDv4 vs UUIDv7', rationale: 'UUIDv4 is 128-bit and totally random — no coordination needed but it ruins B-tree index locality (every insert lands on a random page). Snowflake is 64-bit, time-sortable, but needs a machine_id allocator. UUIDv7 is 128-bit and time-sortable, and PostgreSQL 18 has native support — the new default for greenfield systems that want no coordinator. Snowflake still wins on payload size when you serialize a billion IDs to disk.' },
      { decision: 'Centralized DB-backed sequence vs Snowflake', rationale: 'DB sequence (Postgres BIGSERIAL) is one row updated transactionally — guarantees strict monotonicity but tops out around 100K writes/sec and pins you to one primary region. Snowflake distributes generation to every worker, scales linearly, costs you only rough time-sort. Above ~10K/sec or any multi-region need, Snowflake.' },
      { decision: 'Inline SDK vs remote ID service', rationale: 'Inline SDK gives the fastest hot path (zero network) and zero load on a central tier — at billions of IDs/day this matters. Remote service centralizes the clock concern (one place that needs NTP correctness) and is easier to upgrade. We default to inline SDK with a remote service available for ecosystems (CLI tools, scripts) where the bootstrap dance is awkward.' },
      { decision: 'Wider machine_id field vs more sequence bits', rationale: 'Wider machine_id supports larger fleets (Sonyflake uses 16 machine bits = 65K nodes) but cuts per-node throughput because there are fewer sequence bits per ms. Sticking with Snowflake\'s 10/12 split caps you at 1024 nodes at 4M IDs/sec each — fine for almost anyone. Only switch when your fleet legitimately exceeds 1024 ID-generating processes.' },
      { decision: 'Spin-wait on sequence overflow vs throw error', rationale: 'Spin-wait (~50us) keeps callers happy and hides the bursting from them — the right default. Throwing an error surfaces the burst and lets the caller back off, useful for catching pathological loops. Production typically uses spin-wait with a metric on overflow events; throw on overflows above a sanity ceiling (e.g., 10K/sec sustained).' },
    ],
    keyTakeaways: [
      'Snowflake bit layout is engineered: timestamp high-order for sort, machine_id middle for namespace isolation, sequence low for in-ms throughput',
      'Machine_id allocation is the only coordination point, and it happens once per process — keep the allocator dead simple (ephemeral znode counter)',
      'Backwards clock movement is the only thing that can break uniqueness — detect it explicitly and refuse to issue until time catches up',
      'Time-sortable IDs make B-tree indexes far more cacheable; UUIDv4 is the anti-pattern that costs database performance silently',
      'For most workloads the choice in 2024 is Snowflake-variant (if you have a coordinator) or UUIDv7 (if you do not)',
      'A fleet of 1024 workers at 4M IDs/sec each is 4B IDs/sec — your bottleneck will always be something downstream, not the generator',
    ],
    faqs: [
      { question: 'What is the difference between time-sortable and strictly monotonic, and why do I care?', answer: 'Time-sortable: if event A happens an hour after event B, A\'s ID is greater. This is what Snowflake gives you across a fleet. Strictly monotonic: every successive ID is strictly greater than every previously-issued ID, anywhere in the system. Snowflake does not guarantee this — two workers issuing in the same millisecond will produce IDs whose order does not reflect their order of issue. You care because index inserts into a B-tree are much faster on roughly-sorted IDs (you land on the rightmost page repeatedly) but you must not rely on strict order for correctness — use the timestamp column for that.' },
      { question: 'What stops two workers from getting the same machine_id?', answer: 'Ephemeral sequential znodes in ZooKeeper. When a worker starts, it creates /idgen/workers/n_ — ZooKeeper assigns a strictly increasing sequence number. The worker reads its sequence number, takes its lowest 10 bits as machine_id, and holds the znode for the life of the process. When the worker dies, the znode disappears. New workers get fresh sequence numbers. ZooKeeper internally uses Zab consensus to guarantee no two workers ever get the same sequence number, even under network partition.' },
      { question: 'How do you handle NTP stepping the clock backwards?', answer: 'On every nextId() call, compare current wall-clock ms to the last-emitted ms. If current < last, we are going backwards: pause issuing for at most (last - current) ms and check again. If the skew is small (sub-ms) we wait; if it is large (>50ms) we throw an explicit error so the caller can decide whether to retry or fail. The persisted last_emitted_timestamp on disk also survives restarts, so a clock that gets reset across a process bounce cannot silently produce duplicates. Operationally we configure ntpd/chrony to slew, not step, which avoids this almost entirely.' },
      { question: 'Why not just use UUIDv4 — it needs no coordination at all?', answer: 'Because UUIDv4 destroys B-tree index locality. Every insert is at a random key, so the database fetches a different page from disk per insert. At scale (millions of inserts/day) this is the difference between a hot working set in cache and constant cache misses. Snowflake (or UUIDv7) puts the timestamp first, so inserts land on the right edge of the index and the database loves it. Also, UUIDv4 is 16 bytes vs Snowflake\'s 8 — at billions of rows that\'s real disk and bandwidth.' },
      { question: 'What is the maximum throughput in practice and where is the bottleneck?', answer: 'Per node: 4096 IDs/ms × 1000 ms/s = ~4M IDs/sec from the sequence bits. In practice the bottleneck is caller serialization (the caller cannot drain IDs faster than its own work), JIT/GC overhead in the SDK, or the load balancer in front of remote ID services. We typically see ~1M IDs/sec per node sustained. Fleet-wide, at 1024 nodes that is 4B IDs/sec — vastly more than any actual workload needs.' },
      { question: 'How does this scale across data centers?', answer: 'DC_id is the high 5 bits of the machine field, baked in by config. Each DC runs its own ZooKeeper cluster allocating worker_id (the low 5 bits) within its DC. Because the DC_id is structurally different, cross-DC duplicates are impossible — even with completely independent allocators. Cross-DC clock skew is usually <1ms with chrony pulling from common NTP pools, which is fine for the rough-sort guarantee.' },
      { question: 'What happens if the ZooKeeper cluster is down when a worker tries to start?', answer: 'Two options. (1) Refuse to start — the safe choice, ensures correctness, but means an operational dependency. (2) Fall back to a small pool of static machine_ids reserved per service in config. We use (2) for tier-0 services: each service has 4–8 emergency machine_ids it can claim from local config if ZooKeeper is unreachable, with the trade that those IDs are dedicated to "running with no coordinator" and never get allocated dynamically. On ZK recovery, the worker switches to a fresh dynamic ID at the next safe transition.' },
      { question: 'Can I extract the creation time from a Snowflake ID, and is it accurate?', answer: 'Yes. id >> 22 + custom_epoch gives you the millisecond the ID was minted, with millisecond resolution. It is accurate to whatever your worker\'s wall clock was at the time. Across a fleet with NTP-synced clocks the error is sub-ms; without good time sync you can be off by tens of ms. Treat the extracted timestamp as "creation time, plus or minus the worst clock skew you accept" — usually that is fine for analytics and debugging, never use it for financial timestamps where you need authoritative time.' },
      { question: 'What if a worker bursts past 4096 IDs in one ms?', answer: 'The generator spin-waits for the next ms. The spin is sub-ms so callers do not notice anything except a tiny latency tick. We emit a metric on every overflow event; if a worker is hitting this constantly it means a single caller is hammering one node — either rebalance traffic or give the caller its own ID-generation slot. The hard cap is 4M IDs/sec/node which is far above any realistic single-node workload.' },
      { question: 'Why 41 bits for the timestamp specifically?', answer: 'Because 41 bits of ms covers 2^41 = ~2.2 trillion ms = ~69 years, which is long enough that the original Snowflake authors (Twitter, 2010) figured nobody would be around to care when it overflows. The 1 sign bit must be 0 (positive longs), and the remaining 22 bits split between machine_id (10) and sequence (12). You could shift one bit either way — a 42-bit timestamp gives you 139 years but only 1024 IDs/ms/node, useless. The 41/10/12 split is the sweet spot for typical workloads.' },
    ],
  },
  {
    id: 21,
    slug: 'consistent-hashing',
    title: 'Design Consistent Hashing',
    difficulty: 'Hard',
    category: 'Distributed Systems',
    tags: ['consistent-hashing', 'partitioning', 'vnodes', 'distributed'],
    problemStatement: `Design a consistent hashing system for distributing data across a cluster of nodes where nodes can be added or removed dynamically with minimal data movement. Used in distributed caches (Memcached, Redis Cluster) and key-value stores.`,
    requirements: {
      functional: ['Assign keys to nodes', 'Add a node with minimal key remapping', 'Remove a node with minimal key remapping', 'Handle non-uniform key distribution (hotspots)'],
      nonFunctional: ['O(log N) key lookup', 'Only 1/N keys remapped when a node joins/leaves', 'Even distribution without hotspots'],
    },
    capacityEstimates: `1,000 nodes, each with 150 virtual nodes = 150,000 points on ring\nLookup: binary search O(log 150,000) ≈ 17 comparisons\nKey remapping on node join: 1/N ≈ 0.1% of keys`,
    solutionBreakdown: [
      { section: 'Why Modulo Hashing Fails', content: 'The naive scheme node = hash(key) % N reassigns ~all keys when N changes. Adding one node to a 100-node cluster moves roughly 99% of keys to a different owner. For a distributed cache this is a thundering-herd cache miss across the entire fleet; for a key-value store it is an unacceptable migration cost.\n\nConsistent hashing limits the disruption to ~1/N keys per node change — the structural reason it underpins almost every modern distributed system that has to shard data.' },
      { section: 'Hash Ring Data Structure', content: 'Map a hash function with output space [0, 2^32) onto a circle. Hash each node\'s identifier to a position on the ring; hash each key to a position; the key belongs to the first node walking clockwise from the key\'s position.\n\nIn memory, store the ring as a sorted array of (hash_position, node_id) pairs. Lookup is a binary search for the smallest hash_position ≥ key_hash, wrapping to position 0 if the key is past the last node. O(log N) per lookup, no synchronization needed for reads.' },
      { section: 'Hash Function Choice', content: 'Use a fast, uniform hash with good avalanche: MurmurHash3 (default), xxHash, or CityHash. MD5 works but is 3–10x slower with no quality benefit for non-cryptographic use. SHA-1 is unnecessarily slow.\n\nWhat matters: uniform distribution of node positions (so the ring is balanced) and uniform distribution of keys (so traffic balances). 32-bit output is enough for most clusters; switch to 64-bit if your ring carries millions of vnodes.' },
      { section: 'Virtual Nodes (Vnodes) and Load Balance', content: 'Hashing a single physical node to one ring position gives terrible balance: with 10 nodes the largest could own 30% of keys and the smallest 3%. The fix is virtual nodes: represent each physical node as N vnodes (typical: 100–256), hashed at distinct positions using node_id + vnode_index as input.\n\nWith 150 vnodes per physical node, statistical load imbalance drops to within ~10% of even. You can also vary the vnode count per node to model heterogeneous capacity — a 2× larger node gets 300 vnodes and absorbs 2× the keys. Memory cost: 1000 physical nodes × 150 vnodes = 150K ring entries ≈ a few MB.' },
      { section: 'Adding a Node', content: 'New node generates its 150 vnodes and announces them to the cluster (via membership/gossip). For each new vnode position p, the node walks clockwise to find the previous node\'s position p_prev. The keys in (p_prev, p] currently owned by the next-clockwise node move to the new node.\n\nMigration runs as a streaming copy: source node iterates keys in the affected range, sends them to the new node, the new node acknowledges receipt. Until migration completes, reads are dual-routed (try new node, fall back to old) to avoid a consistency gap. Total keys moved ≈ 1/N of the cluster total.' },
      { section: 'Removing a Node', content: 'Reverse of addition. The vnodes of the leaving node are removed from the ring; their key ranges transfer to the next-clockwise vnode owner (a different physical node, due to randomized vnode placement). The leaving node streams its keys to the new owners before deregistering.\n\nFor unplanned failures (node crashes without graceful shutdown), replicas elsewhere cover; a hinted-handoff buffer on neighboring nodes stores writes destined for the dead node and replays when it returns, or hands off to the next live owner once the failure is confirmed.' },
      { section: 'Replication and Quorum (N, R, W)', content: 'A real system never stores a key on just one node — that would be a single point of failure. For each key, store on the first N nodes clockwise from the key\'s position (N = replication factor, typically 3). Writes go to W of N, reads to R of N; W + R > N gives strong consistency, W + R ≤ N gives availability under partition.\n\nDynamo and Cassandra both use this. Quorum reads typically use the closest-clockwise node as the coordinator and fan out to the other N–1 replicas. Vnodes spread replicas across many physical nodes, avoiding correlated failure if one rack goes down.' },
      { section: 'Membership and Cluster Metadata', content: 'The ring is shared state. Two common patterns: (a) gossip — Cassandra-style, every node tells a random peer its view every second, convergence in O(log N) rounds; (b) centralized coordinator — etcd/ZooKeeper holds the authoritative ring, every node watches for changes. Gossip is operationally simpler; centralized gives strict ordering useful for ops scripts that need to be sure a change committed.\n\nVersion the ring (epoch counter) and reject reads/writes routed using a stale epoch. This prevents a node that missed a membership event from corrupting state by writing to the wrong owner.' },
      { section: 'Hotspots and Bounded Loads', content: 'Random keys do not solve the problem of a single hot key (one viral celebrity\'s profile, one trending search). Two techniques. (1) Salt the key (append a random suffix in one of K buckets) so reads/writes fan out — useful when reads can tolerate gathering K results. (2) Bounded-load consistent hashing (Mirrokni-Thorup, used by Vimeo and Google): cap each node\'s share at c×average; if a hash points at a saturated node, walk further to the next available one.\n\nBounded-load keeps load within (1 + epsilon) of the mean at the cost of slightly more keys moving on join/leave. It is the modern default for load balancers (Envoy, Akamai).' },
      { section: 'Jump Hash and Rendezvous Hashing', content: 'Two alternatives. Jump consistent hash (Lamping & Veach 2014): a closed-form function compute_bucket(key, N) → bucket that moves exactly 1/N keys on N+1. No ring, no vnodes, smaller code. Drawback: nodes must be addressable by integer 0..N-1; harder to model heterogeneous capacity.\n\nRendezvous (HRW) hashing: for each key, compute hash(key, node_i) for every node, pick the node with the highest score. O(N) per lookup but trivial to weight nodes by capacity; used in CDN edge selection and Apache Ignite. For small clusters or capacity-weighted needs, HRW; for large clusters with simple integer mapping, jump hash; for everything else, classic ring with vnodes.' },
      { section: 'Implementation Detail and Performance', content: 'Ring lookup: keep the sorted array of (hash_position, node_id) in CPU-friendly memory. Binary search is ~17 comparisons for 150K entries — sub-microsecond. For cache-line efficiency, eytzinger layout (level-order BFS of the binary search tree) beats classic sorted-array binary search by ~2x on modern CPUs.\n\nUpdates: when a node joins/leaves, rebuild a small affected slice of the sorted array rather than re-sorting the whole thing. Use copy-on-write so readers never see a partial update; swap the pointer atomically when the new ring is built. Migration of actual data dominates total time, not ring updates.' },
      { section: 'Failure Modes and Edge Cases', content: 'Network partition splits the ring view across nodes; without epoch versioning, two nodes both think they own a key and accept writes — split brain. The fix is requiring the most recent epoch on writes, or accepting Dynamo-style eventual reconciliation with vector clocks.\n\nCascading node failures: if 3 nodes fail in sequence, their successor nodes absorb 3× the traffic. Bounded-load consistent hashing limits the multiplier; without it, the survivors melt. Monitor per-node load skew; if it climbs above 2×, page on-call before something tips over.' },
      { section: 'Observability and Tuning', content: 'Metrics that matter: ring_lookup_p99, load_skew_ratio (max_load / mean_load — target <1.2), keys_migrated_per_node_change, vnode_count_per_node, ring_epoch_version. Per-key heat metrics if you have a small set of hot keys to track.\n\nAlerts: load skew >2× sustained (node about to die or hot key), migration backlog growing (a leave is taking too long), ring epoch divergence between nodes (gossip is stuck). The system is mostly self-healing; the metrics tell you when "mostly" stops being true.' },
    ],
    diagram: `graph TB
    subgraph Clients
        AppClient[Application Client]
        SDK[Smart Client SDK]
    end
    subgraph Gateway
        Hasher[Hash Function MurmurHash3]
        Lookup[Ring Lookup Binary Search]
    end
    subgraph Services
        Ring[Hash Ring 0 to 2 to the 32]
        NodeA[Node A vnodes 150]
        NodeB[Node B vnodes 150]
        NodeC[Node C vnodes 150]
        NodeD[Node D newly added]
        Membership[Membership and Gossip]
        Rebalancer[Range Rebalancer]
    end
    subgraph Async
        Migrate[Key Migration Stream]
        HintedHandoff[Hinted Handoff Queue]
        VnodeBalancer[Vnode Load Balancer]
    end
    subgraph Storage
        RingTable[(Sorted Ring Position Table)]
        ClusterMeta[(Cluster Metadata Store)]
        KeyShardA[(Keys on A)]
        KeyShardB[(Keys on B)]
        KeyShardC[(Keys on C)]
    end

    AppClient --> SDK --> Hasher
    Hasher --> Lookup --> Ring
    Ring --> NodeA
    Ring --> NodeB
    Ring --> NodeC

    NodeA --> KeyShardA
    NodeB --> KeyShardB
    NodeC --> KeyShardC

    Lookup -->|GET key| NodeC
    Lookup -->|PUT key| NodeA
    Lookup -->|N replicas clockwise| NodeB

    Membership --> Ring
    Membership --> ClusterMeta
    Ring --> RingTable

    NodeD -.->|join| Membership
    Membership --> Rebalancer
    Rebalancer --> Migrate
    Migrate --> NodeA
    Migrate --> NodeD
    NodeD --> KeyShardA

    NodeC -.->|leave or fail| Membership
    Membership --> HintedHandoff --> NodeA
    VnodeBalancer --> Ring

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    class RingTable,ClusterMeta,KeyShardA,KeyShardB,KeyShardC storage
    class Migrate,HintedHandoff,VnodeBalancer async`,
    tradeoffs: [
      { decision: 'Classic ring vs jump hash vs rendezvous hashing', rationale: 'Classic ring with vnodes is the most flexible (heterogeneous capacity, easy to reason about) and is what you want for stateful stores. Jump hash is tiny and fast but assumes integer-addressable nodes — great for stateless services. Rendezvous (HRW) is O(N) per lookup but supports weighted nodes and clean cache-eviction semantics; widely used in CDN-edge selection.' },
      { decision: '100 vnodes vs 256 vs 1000 per physical node', rationale: 'More vnodes give better statistical balance (1000 vnodes gets you within 3% of even) but more memory in the ring and more migration units. 150 is the long-time Cassandra default and balances the trade well for clusters under ~500 nodes. Above 500 physical nodes, drop to 64–100 vnodes per node to keep the ring under ~50k entries.' },
      { decision: 'Bounded-load consistent hashing vs plain consistent hashing', rationale: 'Plain consistent hashing can let a single hot key or a sequence of additions create persistent skew. Bounded-load caps each node at (1+epsilon) × average load and walks past saturated nodes — guaranteed balance at the cost of a few extra hops per request and a slightly higher migration cost. The modern default for load balancers and CDNs; usually overkill for stateful sharding where you control the workload.' },
      { decision: 'Gossip-based ring vs centralized coordinator', rationale: 'Gossip (Cassandra, Dynamo) needs no single point of failure but takes seconds to converge after a change and makes "did the cluster see this op?" hard to answer. Centralized (etcd/ZooKeeper) gives strict ordering and easy operator scripting but introduces a hard dependency. Choose gossip for very-large auto-scaling clusters; centralized for tightly operated production systems.' },
      { decision: 'Pre-migration dual-route reads vs cutover on completion', rationale: 'Dual-route during migration (read old + new, prefer new) hides the migration entirely but doubles read fanout for affected keys. Cutover-only is cheaper but means a brief inconsistency window when keys appear missing from the new owner. Most production systems use dual-route for the migration window because read amplification on 1/N of keys is cheap and user-visible consistency matters.' },
    ],
    keyTakeaways: [
      'Consistent hashing reduces remapping from O(K) keys to O(K/N) keys when a single node joins or leaves',
      'Virtual nodes turn a 100-node-ring imbalance from 10× into <1.2× — vnodes are not optional in production',
      'The ring lives as a sorted array; lookups are sub-microsecond binary searches with no contention',
      'Bounded-load consistent hashing is the modern default when hot keys or skew are possible',
      'Epoch-versioned ring metadata is the only defense against split-brain writes during partition',
      'Sharding by registered domain or user_id (not host or session_id) keeps related data co-located and politeness/coordination state local',
    ],
    faqs: [
      { question: 'How many keys actually move when a node joins?', answer: 'On average K/N where K is the total key count and N is the new node count. With vnodes the moved keys come from many different existing nodes (since the new node\'s vnodes are spread randomly), which spreads migration load. So a 100-node cluster adding one node moves ~1% of keys total, with each existing node sending ~0.01% — small and parallelizable. Without vnodes, the new node would steal from one neighbor and you would have a hot migration.' },
      { question: 'Why 150 virtual nodes specifically?', answer: 'It is the long-time Cassandra default, chosen because at 150 the statistical load imbalance is around 10% across clusters from 3 to 100 physical nodes — small enough that you don\'t feel it. More vnodes get you closer to even but cost ring memory and migration units. Less than 100 starts to show real skew on small clusters (5–10 nodes). It is a tunable constant; for very large clusters (>500 nodes) drop it to 64 to keep total ring entries reasonable.' },
      { question: 'What hash function should I use, and does the choice matter?', answer: 'MurmurHash3 is the practical default — fast, uniform, available everywhere. xxHash is even faster, especially for long keys. Avoid cryptographic hashes (MD5/SHA) for consistent hashing — they are 5–10× slower with no benefit. What matters is uniformity (so ring positions distribute evenly) and avalanche (so similar keys hash to different positions); MurmurHash and xxHash both excel at this. The bit-width matters less than people think; 32 bits is enough for ring positions up to a few hundred thousand vnodes.' },
      { question: 'How does this interact with replication?', answer: 'A key\'s "owner" is just the first vnode clockwise. Replicas are stored on the next R-1 vnodes clockwise (skipping vnodes that belong to the same physical node so all replicas land on different machines). With R=3 and vnode placement randomized, replicas naturally spread across racks/AZs because random vnode positions rarely cluster on neighboring machines. This is how Cassandra gets rack-aware replication for free from consistent hashing.' },
      { question: 'What happens if two nodes have the same machine_id (or two vnodes collide in hash position)?', answer: 'Vnode hash collisions are astronomically unlikely with 32-bit hash space and a few hundred thousand vnodes (birthday paradox math: ~1 in 100K rings have any collision). If one occurs, it is harmless: both vnodes own the same range; the one read first wins, and you have an effective duplicate vnode. For node_id collisions, the bootstrap process explicitly checks and refuses to register a second node with the same id — same defense as Snowflake machine_id allocation.' },
      { question: 'How do you handle hot keys that all map to one node?', answer: 'Three options. (1) Salt the key with a random bucket suffix (key#1, key#2, ..., key#K) and read all buckets — works for high-read, low-write distribution but needs application changes. (2) Bounded-load consistent hashing: if the hot key\'s owner is over the load cap, walk to the next node; readers do the same lookup. (3) Replicate the hot key to many more nodes than R via "anti-entropy" replication; reads pick any replica. The right answer depends on whether the hotness is permanent (Justin Bieber\'s profile) or transient (today\'s viral tweet).' },
      { question: 'How is this different from sharding by key range (e.g., A-F on node 1, G-L on node 2)?', answer: 'Range sharding gives ordered iteration ("get all keys starting with M") almost for free but creates hot ranges (every event timestamped today hits the same node). Consistent hashing gives uniform distribution but loses the ordering. HBase/BigTable use range sharding (with manual splits) for the iteration benefit; Cassandra and Dynamo use consistent hashing for the balance benefit. The choice is workload-driven: range scans → range; uniform random access → consistent hashing.' },
      { question: 'What is jump consistent hash and when should I use it instead?', answer: 'Jump hash is a closed-form function bucket = jumpHash(key, N) that returns an integer in [0, N) and moves exactly K/N keys when N grows to N+1. It needs no ring data structure, has ~50 lines of code, and is faster than ring lookup. The constraint: nodes must be addressable by integers 0..N-1, which makes heterogeneous capacity awkward. Great for stateless service fanout (Envoy uses it internally); not great for stateful storage where you want to model node weights and orderly add/remove.' },
      { question: 'How do you migrate keys when a node joins without breaking ongoing reads?', answer: 'The new node announces its presence to the cluster (membership update with new epoch). Both old and new nodes mark the affected key range as "migrating." Reads during the window try the new owner first, fall back to the old owner if the key is not there yet. Writes go to both owners until cutover. The source streams keys to the new node in the background. When the source confirms it has sent the last key, the cluster updates to a new epoch and the old node stops serving the range. No request ever sees a missing key.' },
      { question: 'Is consistent hashing necessary for stateless load balancing, or just for stateful storage?', answer: 'It is most useful for stateful storage where you absolutely cannot tolerate moving most keys on cluster change. For stateless load balancing, plain round-robin or random is fine if servers are interchangeable. Consistent hashing comes in when you want sticky routing — sessions go to the same server, cache locality is preserved — but you also want graceful failover. Envoy\'s "Maglev" and "Ring Hash" load-balancing policies are exactly this. For pure stateless fanout where the worker has no in-process cache, consistent hashing is overkill.' },
    ],
  },
  {
    id: 22,
    slug: 'distributed-locking',
    title: 'Design a Distributed Locking Service',
    difficulty: 'Hard',
    category: 'Distributed Systems',
    tags: ['locking', 'mutex', 'raft', 'zookeeper', 'fencing'],
    problemStatement: `Design a distributed locking service that allows processes across multiple machines to acquire exclusive locks on shared resources. Must be correct under network partitions and process failures. Inspired by Chubby (Google) and ZooKeeper.`,
    requirements: {
      functional: ['Acquire a named lock (blocking or tryLock)', 'Release a lock', 'Lock auto-expires if holder crashes (TTL)', 'One lock holder at a time — guaranteed'],
      nonFunctional: ['Correctness under network partition', 'No split-brain (two holders simultaneously)', 'Lock acquisition < 100ms', 'Survive minority node failures'],
    },
    capacityEstimates: `Low throughput: 10K lock acquisitions/sec\nHigh correctness requirement\nUse strong consensus (Raft) — 3 or 5 node cluster`,
    solutionBreakdown: [
      { section: 'API Surface and Semantics', content: 'A minimal correct surface: acquire(name, ttl_seconds, fencing=true) returns {lock_token, fencing_token, expires_at} or NOT_AVAILABLE. release(name, lock_token) frees the lock if the token matches the current holder. renew(name, lock_token, ttl_seconds) extends the lease. tryAcquire(name, timeout_ms) waits up to timeout for the lock to become available.\n\nThe lock_token is a UUID identifying the specific acquisition instance, used to prevent a stale holder from releasing the lock that someone else now holds. The fencing_token is a separate monotonically increasing integer used by the protected resource to reject stale operations even after lock expiry.' },
      { section: 'Why Strong Consensus Is the Floor', content: 'Distributed locks have a single correctness invariant: at most one holder at a time. Any implementation that can permit two holders under failure is structurally broken for any workload that uses the lock to coordinate state-changing operations.\n\nStrong consensus (Raft, Paxos, Zab) is the only family of protocols that maintains this invariant under arbitrary partition and process pause. Implementations built on weaker primitives (gossip, single-instance Redis SET NX) either give up correctness or rely on assumptions (bounded clock drift, bounded GC pauses) that production systems violate.' },
      { section: 'Raft-Based Lock State Machine', content: 'Run a 3 or 5 node Raft cluster (e.g., etcd, Consul, or in-house). Lock state is keys in the replicated KV store: /locks/{name} → { owner_token, fencing_token, expires_at, holder_metadata }. Every acquire/release/renew is a Raft log entry committed by majority quorum.\n\nA single Raft commit guarantees: linearizable visibility (no two clients see contradictory results), durability (majority quorum survives minority failures), and at-most-once application (every committed entry runs in the state machine exactly once). The acquire operation atomically checks-and-sets: succeeds only if the key is absent or expired. The fencing_token is incremented on every successful acquire.' },
      { section: 'Lease TTL and Renewal', content: 'Locks must expire — otherwise a crashed holder freezes the resource forever. Each lock has a lease TTL (typical: 10–60 seconds). The holder must call renew before expires_at, otherwise the lock becomes available for re-acquire.\n\nClient-side renewal runs on a timer at TTL/3 (so two renew failures still leaves time for a third before expiry). Renew sends the lock_token; the consensus cluster validates it matches the current holder, then extends expires_at. The TTL is short enough that a crashed holder does not block work for long, long enough that normal renewal traffic is cheap.' },
      { section: 'Fencing Tokens: the Only Defense Against Pauses', content: 'The hard truth: TTL expiry alone does not prevent two holders from operating simultaneously. A holder can be paused (GC, swap, hypervisor freeze) after acquiring; its TTL expires; another client acquires; the original holder unfreezes and runs its critical-section code believing it still holds the lock. Two holders, one corrupted state.\n\nFencing tokens close this gap. The protected resource (database, queue, inventory) records the highest fencing_token it has seen and rejects any operation with a lower token. When the paused holder wakes up and tries to write with its old (lower) token, the resource refuses. The resource itself becomes the arbiter; the lock service merely issues monotonically increasing tokens.' },
      { section: 'ZooKeeper Ephemeral Sequential Nodes', content: 'A specific implementation pattern. Clients create an ephemeral sequential znode under /locks/foo/: ZooKeeper assigns each one a strictly increasing suffix. The client lists siblings; the holder is the lowest-suffix znode. Others watch the znode immediately before them in sequence order.\n\nWhen the holder dies (session timeout, ephemeral znode disappears), only the next-in-line is notified via its watch — no thundering herd of every waiter waking up. This pattern naturally handles ordering (acquisition order = creation order) and cleanup (crashed holder\'s znode auto-deletes). It is how Chubby and most ZooKeeper recipes structure locks.' },
      { section: 'Why RedLock Is Controversial', content: 'RedLock acquires a lock on majority of N independent Redis instances by SET NX PX. The argument: as long as a majority of Redis instances see the lock, you have mutual exclusion. Antirez argues it is correct; Martin Kleppmann argues it is not, because Redis instances are not connected by consensus and clock drift / process pauses break the assumptions.\n\nKleppmann\'s concrete attack: holder GC-pauses; TTL expires; second client acquires on a new Redis quorum; holder wakes up still inside its critical section and writes. Without fencing tokens on the protected resource, the second holder\'s state gets clobbered. RedLock is acceptable only when (a) the workload tolerates duplicate holders briefly, or (b) fencing tokens are enforced downstream — at which point you could have used any lock primitive.' },
      { section: 'Client-Side Liveness and Pause Detection', content: 'A careful client renews on TTL/3 and also monitors elapsed time inside the critical section: if more than (TTL × 0.8) passes since acquire, the client assumes the lock has expired and aborts work rather than continuing. This is belt-and-suspenders against process pauses that the client did not notice.\n\nA paranoid pattern: capture monotonic clock at acquire; before every state-changing operation, recheck elapsed; abort if approaching TTL. Combined with fencing tokens downstream, this is genuinely safe under arbitrary pauses.' },
      { section: 'Failure Modes', content: 'Raft cluster minority failure (1 of 3 nodes down): everything works normally; majority quorum still achievable. Majority failure (2 of 3 nodes down): the cluster stops accepting writes — locks cannot be acquired or released until quorum is restored. This is the correct CP behavior; the alternative (continuing to issue locks) would break the invariant.\n\nLeader election during partition: ongoing acquire/release/renew requests time out; clients retry against the new leader. The brief window of no-leader is on the order of leader-election timeout (typically 1–2 seconds). Clients should expect retries, and tryAcquire should distinguish "not available" (someone else holds it) from "service unavailable" (cluster reconfiguring).' },
      { section: 'Throughput and Latency Characteristics', content: 'Per Raft round-trip: median ~10ms intra-DC, ~50ms cross-DC. Throughput: ~10K acquire/release per second per Raft cluster — enough for any coordination workload but not enough to use a distributed lock per database row. The lock fan-in pattern (one lock for a whole table) is what makes distributed locking unsuitable for fine-grained synchronization.\n\nFor high-throughput per-key serialization, sharded locks per key prefix help: hash the lock name to one of N Raft clusters. This buys linear throughput at the cost of more clusters to operate.' },
      { section: 'Operational Concerns and Backup', content: 'The Raft log grows forever without compaction; periodic snapshots truncate the log to a single state. etcd snapshots every 10K log entries by default; restore is a routine operation. Backup the Raft state to durable storage (S3) every few hours so a catastrophic loss of all replicas can be recovered.\n\nObservability: leader_election_count (any nonzero in steady state is interesting), lock_acquire_p99, active_locks_count, expired_locks_per_sec, fencing_token_max. Pages on leader_election_count > 0 in steady state (the cluster is unhealthy) and on lock_acquire_p99 > 100ms (likely a partition or full disk on a Raft node).' },
      { section: 'Use Cases and Anti-Patterns', content: 'Good uses: leader election for stateful jobs (one cron runs at a time), exclusive write to a tiny shared resource (config file, single binary deploy), distributed semaphore for rate-limited APIs, ensuring exactly-one consumer for a serial stream.\n\nAnti-patterns: locking individual database rows (use the database\'s row locking), locking around long network calls (the TTL inevitably races with the call), locking to provide ordering of unrelated operations (use a queue), locking as a substitute for idempotency keys (idempotency is cheaper and more robust). The rule of thumb: if you can solve the same problem with an idempotency key or a CAS on a single database row, do that instead.' },
      { section: 'Comparison with Database Row Locks and Optimistic Concurrency', content: 'A distributed lock service is the answer when the resource to protect is not itself a transactional database. If your protected resource is a single Postgres database, SELECT FOR UPDATE on a row is faster, simpler, and equally safe. If it is a file in S3, an external API, or a fleet of caches, you need a distributed lock or — better — an idempotency mechanism downstream.\n\nOptimistic concurrency (compare-and-swap on a version column) often replaces the lock entirely: do the work without holding a lock, then atomically commit only if the underlying state has not changed. Cheap when conflicts are rare; locking wins only when conflicts are common and serialization is necessary.' },
    ],
    diagram: `graph TB
    subgraph Clients
        ClientA[Worker A]
        ClientB[Worker B]
        ClientC[Worker C]
    end
    subgraph Gateway
        LockSDK[Lock SDK]
        LB[Load Balancer]
    end
    subgraph Services
        LockSvc[Lock Service API]
        RaftLeader[Raft Leader]
        RaftF1[Raft Follower 1]
        RaftF2[Raft Follower 2]
        SeqNode[Sequential Node Manager]
        FencingSvc[Fencing Token Issuer]
        LeaseSvc[Lease Renewal Service]
        Watcher[Watch Notifier]
    end
    subgraph Async
        LeaseExpiry[Lease Expiry Sweeper]
        ElectionJob[Leader Election]
        SnapshotJob[Raft Snapshot]
    end
    subgraph Storage
        RaftLog[(Replicated Raft Log)]
        LockState[(Lock State KV)]
        TokenCounter[(Monotonic Fencing Counter)]
        Snapshot[(Snapshot Store)]
    end
    subgraph Services2 [Protected Resource]
        Resource[Database or Inventory]
        ResourceGuard[Token Validator]
    end

    ClientA --> LockSDK --> LB --> LockSvc
    ClientB --> LockSDK
    ClientC --> LockSDK

    LockSvc -->|acquire| RaftLeader
    RaftLeader --> RaftLog
    RaftLeader -->|replicate| RaftF1
    RaftLeader -->|replicate| RaftF2
    RaftLeader --> LockState
    RaftLeader --> FencingSvc --> TokenCounter

    LockSvc -->|sequential ephemeral| SeqNode
    SeqNode --> Watcher
    Watcher --> ClientB

    LockSvc -->|fencing token| ClientA
    ClientA -->|request with token| ResourceGuard --> Resource
    ResourceGuard -->|reject stale| ClientA

    ClientA -->|renew lease| LeaseSvc --> RaftLeader
    LeaseExpiry --> LockState
    LeaseExpiry -->|release| Watcher

    ElectionJob --> RaftLeader
    SnapshotJob --> Snapshot

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    class RaftLog,LockState,TokenCounter,Snapshot storage
    class LeaseExpiry,ElectionJob,SnapshotJob async
    class LB edge`,
    tradeoffs: [
      { decision: 'Raft (etcd/Consul) vs ZooKeeper vs RedLock', rationale: 'Raft-based (etcd, Consul) is the modern default — proven safe, well-understood, used by Kubernetes itself. ZooKeeper has the ephemeral-sequential-node recipe that elegantly handles fairness and notification, but Zab is an older protocol and ZooKeeper ops is harder. RedLock is simpler to deploy on existing Redis but has documented safety gaps; only use it where the downstream resource enforces fencing tokens.' },
      { decision: 'Short TTL with frequent renewal vs long TTL', rationale: 'Short TTL (10s) means a crashed holder unblocks the resource fast, but renewal traffic is constant and a brief network blip can lose the lock. Long TTL (5 min) is cheap to maintain but a crashed holder blocks the resource for minutes. The right answer depends on the cost of the blocked resource; for hot resources use short TTLs and design clients to renew on every iteration of the critical-section loop.' },
      { decision: 'Optimistic concurrency vs distributed lock', rationale: 'Optimistic (compare-and-swap on a version column) is dramatically cheaper when contention is rare — no coordination cost at all on the happy path. Distributed locks serialize work upfront which is necessary only when conflicts are common and ordering matters. Default to optimistic; reach for a lock only when retry storms or the work itself is too expensive to redo.' },
      { decision: 'Fencing tokens always vs only when needed', rationale: 'Always-fencing is safer (every protected resource enforces monotonic tokens; no way for a stale holder to corrupt state) but every protected resource must support it. Sometimes the protected resource is third-party (S3, a payment API) and cannot enforce tokens. Without fencing, you trade correctness under arbitrary pauses for simplicity; accept that and document the failure mode.' },
      { decision: 'One Raft cluster for all locks vs sharded clusters', rationale: 'One cluster is simplest to operate but caps throughput at ~10K locks/sec. Sharded clusters (hash lock_name to one of N Raft clusters) buy linear scale at the cost of N times the operational burden. Most teams never need sharding; if you do, you are using locks at a granularity that probably warrants rethinking.' },
    ],
    keyTakeaways: [
      'Strong consensus (Raft/Paxos/Zab) is the only family of protocols that holds mutual exclusion under arbitrary partition and process pause',
      'TTL alone is not safe — a paused holder can wake up after expiry and corrupt state without fencing tokens enforced at the resource',
      'Fencing tokens make the protected resource the arbiter; the lock service merely issues monotonically increasing numbers',
      'RedLock is unsafe without downstream fencing; the safety argument requires assumptions that production systems violate',
      'Throughput is capped around 10K acquire/sec per Raft cluster — distributed locks are for coordination, not per-row synchronization',
      'Prefer idempotency keys or compare-and-swap when you can; reach for distributed locks only when you genuinely need mutual exclusion across processes',
    ],
    faqs: [
      { question: 'Why is a TTL alone insufficient — is not auto-expiry the whole point?', answer: 'TTL handles the case where the holder dies. It does not handle the case where the holder is paused. A GC pause, a hypervisor freeze, a swap-induced stall, or a misbehaving thread can hold the holder for minutes. The lock service sees no renewal, expires the lock, gives it to another client. The original holder wakes up still inside its critical section, believes it holds the lock (because nothing told it otherwise), and writes to the protected resource. Two simultaneous holders. The fix is fencing tokens: the resource refuses writes from the older token.' },
      { question: 'What exactly is a fencing token and where does it live?', answer: 'It is a monotonically increasing integer issued on every successful acquire. The lock service tracks the current max and increments it on each new acquire. The protected resource (database, file system, queue) records the highest fencing_token it has accepted and rejects any operation with a lower one. Crucially, the resource is the arbiter — the lock service does not stop the stale holder from sending requests; the resource just refuses them. Without resource-side enforcement, fencing tokens are useless; this is the part RedLock\'s safety argument misses.' },
      { question: 'How does ZooKeeper avoid thundering herd on lock release?', answer: 'Clients create ephemeral sequential znodes under the lock path, and each waiter watches only the znode immediately before its own in the sequence. When the holder dies (ephemeral znode disappears), exactly one watcher fires — the next-in-line. That client now finds itself at the head and acquires the lock. All other waiters were watching different (still-existing) znodes, so they were not woken. This is a structural property of the recipe, not a bolt-on optimization.' },
      { question: 'Why do people argue RedLock is broken?', answer: 'Kleppmann\'s argument has two parts. (1) RedLock\'s safety depends on bounded clock drift across Redis instances; under unbounded drift, a holder\'s lock could expire on one Redis before another sees it expire, allowing a second acquirer. (2) Process pauses (GC, swap, hypervisor) can pause a holder after acquire; without fencing tokens enforced downstream, the holder wakes up and writes alongside a new holder. Antirez countered that drift is bounded in practice and pauses are rare; Kleppmann\'s rejoinder was that "rare" is not the same as "impossible" for systems that must be correct.' },
      { question: 'How long should a lock TTL be?', answer: 'Long enough that normal work plus a few renewals fits comfortably; short enough that a crashed holder does not block the resource long. Defaults: 10–30 seconds for general locks, with renewal every TTL/3. For very long-running work (a batch job), pick a longer TTL (5 min) and renew accordingly; do not pick a TTL of "however long the work takes" — that assumes the work is bounded, which is exactly the assumption that gets you in trouble. Make the work resumable and the TTL short.' },
      { question: 'What happens during a Raft leader election — can I acquire a lock?', answer: 'No, briefly. The cluster has no leader; writes (acquire/release/renew) are paused. Clients see timeouts or NOT_LEADER errors. Election typically completes in 1–2 seconds; clients should retry. Read-only operations may continue (etcd supports linearizable reads via ReadIndex protocol that survives short outages). The bigger risk is renew failure during election: if your renewal fires during the leader-less window and times out, you may lose the lock. Renew on TTL/3, not TTL/2, so a single failure still leaves you a retry.' },
      { question: 'Can I use a distributed lock to enforce exactly-once consumption from a queue?', answer: 'You can but it is usually the wrong tool. The right tool is idempotency: every queue message carries a unique id, the consumer records processed ids in a dedup table (or set), duplicate deliveries get filtered out. This handles the actual problem (at-least-once delivery from the queue) without serializing all consumers. Locks force serialization which kills throughput; idempotency lets you parallelize fearlessly. Use a lock only when serialization is itself the requirement (e.g., per-key ordering).' },
      { question: 'What is the maximum lock throughput I can get from one Raft cluster?', answer: 'Order of 10K acquire/release per second from a 5-node etcd cluster on modern hardware. The bottleneck is the Raft consensus round trip: each operation requires majority replication, which is ~10ms intra-DC and ~50ms cross-DC. If you need more, shard by lock-name hash across multiple clusters; if you need orders of magnitude more, you are probably using locks at too fine a granularity and should redesign with idempotency or partitioned ownership.' },
      { question: 'How does this play with multi-region deployments?', answer: 'Two options. (1) One global Raft cluster spanning regions: acquires pay cross-region latency (50–200ms) but you have one source of truth; appropriate for low-throughput, correctness-critical locks. (2) Per-region Raft clusters with hash-based assignment of lock names to regions: fast local acquires, but a region failure blocks the locks it owns. Most production systems pick (1) for the small set of truly global locks and accept the latency hit.' },
      { question: 'What is the simplest way to safely release a lock I might not still hold?', answer: 'Pass the lock_token (the UUID issued at acquire) on the release call. The lock service compares it to the current owner_token in its state machine; if they match, release; if not, the call is a no-op. This protects against the case where your TTL expired, someone else acquired, and you only now figured out you should release. Without lock_token validation, your stale release would steal the lock from the new holder — a different kind of corruption than the fencing problem but equally bad.' },
    ],
  },
  {
    id: 23,
    slug: 'design-google-search',
    title: 'Design Google Search',
    difficulty: 'Hard',
    category: 'Search',
    tags: ['search', 'index', 'ranking', 'pagerank', 'crawler'],
    problemStatement: `Design a web search engine like Google. Users enter queries and receive a ranked list of relevant web pages. The system must index billions of pages and return results in milliseconds.`,
    requirements: {
      functional: ['Crawl and index billions of web pages', 'Accept keyword queries and return ranked results', 'Support phrase search, filters (date, type)', 'Auto-suggest queries', 'Handle 10,000 queries/sec'],
      nonFunctional: ['Query response < 200ms', 'Index freshness: new pages indexed within hours', 'Billions of indexed pages', 'High availability'],
    },
    capacityEstimates: `50B web pages × 100KB avg = 5 PB raw\nInverted index: ~10% of raw = 500 TB\n10K queries/sec × avg 10 results = 100K doc lookups/sec`,
    solutionBreakdown: [
      { section: 'Query API and User Experience', content: 'GET /search?q=...&page=N&hl=lang&safe=on returns ten ranked results with title, snippet, URL. Sub-endpoints: /suggest for typeahead, /spell for did-you-mean, /knowledge for the right-side panel. Auth is anonymous by default; a cookie or signed-in user-id enables personalization features (history, profile-based ranking).\n\nWhat the user perceives as "Google" is hundreds of subsystems composed at this endpoint. The frontend orchestrates spell-check, autosuggest, parallel index queries, ad serving, knowledge panel lookup, image/video universal results — all within a ~200ms budget. Each subsystem has its own SLA and graceful-degradation mode.' },
      { section: 'Pipeline: Crawl, Parse, Index, Serve', content: 'The lifecycle of a page: crawled by the distributed fetcher (see Web Crawler design), stored as raw HTML in object storage, parsed by an extraction pipeline that produces structured tokens + metadata, written to the inverted index via a build job (MapReduce in classic Google, Tensorflow extended pipelines or Beam now), served from in-memory shards at query time.\n\nLatency budget on the read side: ~200ms p99 from query receipt to first byte sent. Latency tolerance on the write side: hours for normal pages, minutes for news (a separate fast-path "Caffeine-style" pipeline pushes high-priority updates straight into incremental index segments).' },
      { section: 'Inverted Index Structure', content: 'Per term, a posting list: an array of (doc_id, term_frequency, positions[], field_flags). doc_id is a 64-bit dense identifier; the posting list is sorted by doc_id for fast intersection. Postings are compressed with variable-byte (VByte) or PForDelta encoding — a posting list of 1B doc_ids compresses to 100s of MB rather than 8 GB.\n\nThe index has additional structures: forward index (doc_id → list of terms, used for snippets and feature extraction), document metadata (title, URL, lang, timestamp, PageRank), and per-field positional indexes (titles, body, anchor text scored differently). Anchor text — the text other pages use to link to this one — is one of the strongest relevance signals; it gets its own posting list.' },
      { section: 'Sharding Strategy: Document-Partitioned vs Term-Partitioned', content: 'Two structural choices. Document-partitioned: each shard holds the full index for 1/N of all documents. Queries fan out to all shards (every shard might have a matching doc); each shard returns its local top-K; root merges. Used by Google because it scales document count linearly and rebuild is shard-local.\n\nTerm-partitioned: each shard holds the full posting list for 1/N of all terms. Queries hit only the shards holding the queried terms. Lower fan-out, but skewed terms (common words) make hot shards and updates are messier. Used in niche cases. Document-partitioning wins for web-scale general search because it amortizes the fan-out cost (you would fan out anyway for popular queries with many terms).' },
      { section: 'Query Processing Pipeline', content: 'Query receipt: tokenize, lowercase, language-detect, run spell-check, apply synonyms (car → automobile in some contexts). Query rewriting may add ANDed terms or expand abbreviations.\n\nDispatch to root. Root fans out to all leaf shards in parallel (hundreds to thousands). Each leaf: fetch posting lists for the query terms, intersect them (AND-mode) using galloping/skip-list intersection, score each surviving doc with BM25, return local top-K (typically K=100 per shard). Root merges all shard top-Ks (heap merge), now has the global top NK candidates.\n\nReranking: send the top ~1000 candidates to the ML reranker for final scoring, return top 10 to user. Snippet generation happens last using the forward index.' },
      { section: 'Ranking Signals and Models', content: 'Hundreds of signals, the famous ones: PageRank (link graph), BM25 (term frequency with length normalization), anchor text relevance, freshness (especially for news), language match, location proximity, click-through history, mobile-friendliness, HTTPS, page speed. Plus hundreds more.\n\nModels in layers: a fast L0 model on the leaf for initial top-K, a heavier L1 reranker on the root (gradient-boosted tree on hundreds of features), and an L2 deep model (BERT-derived) on the final top ~100. Each layer has a tighter latency budget than its predecessor. The deep model can only see a hundred candidates because BERT inference at 1B candidates would melt the planet.' },
      { section: 'PageRank and Link Graph', content: 'Classical PageRank: PR(p) = (1-d)/N + d × Σ(PR(q)/out_degree(q)) for all q linking to p. Iterative; converges in ~50 passes for the web graph. Run as a giant MapReduce/Spark job over the link graph extracted from crawled pages.\n\nUpdated weekly (not daily — the cost is enormous and freshness gains are minimal). Modern Google has long since blended PageRank with many other link-based signals; the canonical algorithm is still the textbook reference even if production uses much more. Anchor text is, in many ways, the more important link-derived signal — it tells you what other people call this page.' },
      { section: 'Index Freshness and Caffeine-Style Incremental', content: 'Two pipelines. Batch: rebuild segments of the index nightly or weekly from the full crawled corpus. Predictable, complete, expensive. Incremental ("Caffeine"): crawl high-priority URLs constantly (news sites, breaking-story sources), index the new content into small incremental segments that the leaf serves alongside the main index, merge incremental into main during the next batch build.\n\nLeaf-side: query both the main index and the recent incremental segments, merge results. Increments are typically 1–5% of main index size; queries cost a little more but freshness is hours, not days. News results need this; canonical reference pages (Wikipedia\'s "France" page) do not.' },
      { section: 'Knowledge Graph and Entity Resolution', content: 'Beyond ranked text documents, modern search recognizes entities. The Knowledge Graph holds tens of billions of facts ([entity, relation, value]) extracted from structured sources (Wikipedia, Wikidata, semantic web data) and verified against authoritative pages. Query "Marie Curie birthday" routes to an entity lookup, returning the answer directly in a knowledge panel without retrieving documents.\n\nDispatch decision: a query-classifier estimates whether the query is informational, navigational, or transactional, and whether it has a clean entity answer. Entity answers render with citation; document results render below. The KG is updated through both batch ETL from Wikidata and signal extraction from new web crawls.' },
      { section: 'Caching: Hot Query Cache and CDN', content: 'A small fraction of queries (the head of the Zipf distribution) account for a huge share of total traffic. "Weather", "facebook", and a few thousand other queries get the same answer billions of times per day. Cache the rendered SERP for hot queries in a query cache with short TTL (1–60 minutes depending on freshness sensitivity).\n\nCache hit ratio at the head can be 30–50%; misses hit the full pipeline. Personalized queries bypass the cache. CDN at the edge serves the static parts of the SERP (HTML scaffolding, JavaScript) and pre-rendered SERPs for the very top queries; the dynamic top-10 list still comes from the origin to avoid stale content.' },
      { section: 'Spell Correction, Autosuggest, and Related Queries', content: 'Spell correction is a noisy-channel model: given the typed query, find the most likely intended query using a Bayesian combination of edit-distance probability (typing model) and query-frequency prior (language model). Modern systems use neural seq2seq models that handle phonetic errors and slang.\n\nAutosuggest runs a separate index (see Typeahead design) of frequent queries, returning top-N completions in <100ms. Related queries on the SERP come from co-click analysis: queries whose result sets users frequently switch between are deemed related.' },
      { section: 'Anti-Spam and Quality Signals', content: 'The open web is adversarial. Manipulation tactics: link farms (cliques of low-quality pages linking to each other to inflate PageRank), keyword stuffing (target keywords repeated thousands of times in invisible text), doorway pages (pages designed for crawlers with content unlike what users see — "cloaking").\n\nDefenses: link-graph analysis detects unnatural link patterns (TrustRank, SpamRank papers). Topical relevance models penalize pages where on-page content does not match anchor-text claims. Manual review queues for newly discovered domains with weak signals. Penalties propagate through the link graph — links from penalized domains count for less.' },
      { section: 'Personalization and Privacy', content: 'Personalization signals: recent search history, geographic location, device type, signed-in user preferences. Personalization is a final reranking step that adjusts the top-10 order; it does not change which documents are candidates.\n\nPrivacy levers: searches in private mode skip personalization. Stored search history is encrypted at rest; users can delete it; auditable retention policies. Federated learning approaches are being explored to compute personalized signals on-device without sending raw history to the server. Search-quality benefits of personalization are real but modest at the average query; freshness, relevance, and PageRank still dominate.' },
      { section: 'Observability and Quality Measurement', content: 'Query-level metrics: latency p50/p99 broken down by leaf-fetch, merge, rerank, render. Quality metrics: CTR, click-back rate (user clicks first result and immediately goes back — a quality signal of an unsatisfactory result), time-to-first-click, query-reformulation rate (user types a related query immediately after — they did not find what they wanted).\n\nLong-cycle quality: human raters periodically score sampled queries against the SERP; the score (NDCG) becomes a training signal for the ranking model. Side-by-side experiments (Sxn — control SERP vs candidate SERP) drive every change to the algorithm. No change ships without statistically significant quality wins on multiple metrics.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Browser[Browser]
        MobileApp[Mobile App]
        VoiceSearch[Voice Search]
    end
    subgraph Edge
        CDN[Global Edge Cache]
        GeoDNS[Geo-DNS]
    end
    subgraph Gateway
        APIGW[Search Frontend]
        AntiSpam[Spam and Bot Filter]
    end
    subgraph Services
        QueryParser[Query Parser and Tokenizer]
        SpellCheck[Spell Correction]
        Autosug[Autosuggest Service]
        Root[Root Aggregator]
        IndexLeaf1[Index Leaf Shard 1]
        IndexLeaf2[Index Leaf Shard 2]
        IndexLeafN[Index Leaf Shard N]
        BM25[BM25 Scorer]
        MLRanker[BERT Reranker]
        Snippets[Snippet Builder]
        AdServer[Ads Server]
    end
    subgraph Async
        Crawler[Distributed Crawler]
        Indexer[Index Builder MapReduce]
        PageRankJob[PageRank Iterative]
        Incremental[Incremental Indexer]
        ClickLog[Click Log Pipeline]
    end
    subgraph Storage
        BlobStore[(Crawled HTML S3)]
        InvIdx1[(Inverted Index Shard 1)]
        InvIdx2[(Inverted Index Shard 2)]
        InvIdxN[(Inverted Index Shard N)]
        DocStore[(Doc and Snippet Store)]
        PRStore[(PageRank Scores)]
        QueryCache[(Hot Query Cache)]
    end
    subgraph Analytics
        EventBus[Search Events]
        Lake[(Data Lake)]
        ModelStore[ML Model Store]
    end

    Browser -->|query| GeoDNS --> CDN --> APIGW
    MobileApp --> APIGW
    VoiceSearch --> APIGW
    APIGW --> AntiSpam
    APIGW --> Autosug

    APIGW --> QueryParser --> SpellCheck
    QueryParser --> QueryCache
    QueryCache -.->|miss| Root

    Root -->|fan-out| IndexLeaf1 --> InvIdx1
    Root -->|fan-out| IndexLeaf2 --> InvIdx2
    Root -->|fan-out| IndexLeafN --> InvIdxN
    IndexLeaf1 --> BM25 --> Root
    Root --> MLRanker --> ModelStore
    MLRanker --> Snippets --> DocStore
    Snippets --> APIGW --> Browser
    Root --> PRStore

    APIGW --> AdServer

    Crawler --> BlobStore
    BlobStore --> Indexer
    Indexer --> InvIdx1
    Indexer --> InvIdx2
    BlobStore --> PageRankJob --> PRStore
    Incremental --> InvIdx1

    Browser -->|click| ClickLog --> EventBus --> Lake
    Lake --> ModelStore

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class BlobStore,InvIdx1,InvIdx2,InvIdxN,DocStore,PRStore,QueryCache storage
    class Crawler,Indexer,PageRankJob,Incremental,ClickLog async
    class CDN,GeoDNS edge
    class EventBus,Lake,ModelStore analytics`,
    tradeoffs: [
      { decision: 'Document-partitioned vs term-partitioned index', rationale: 'Document-partitioned scales document count linearly and makes shard rebuilds independent. Every query fans out to every shard but you pay the same fan-out cost anyway for multi-term queries. Term-partitioned hits fewer shards per query but creates hot shards on common terms and makes updates harder. Web scale chose document-partitioning long ago.' },
      { decision: 'Batch rebuild vs incremental indexing (Caffeine-style)', rationale: 'Batch is simpler, predictable, and cheap per page (good amortization). Incremental keeps freshness measured in minutes instead of hours, essential for news and trending content. The right answer is both: batch builds the main index, incremental segments cover the fresh tail and merge into the main index on the next batch cycle.' },
      { decision: 'Heavy ML reranker on every query vs cached SERPs for hot queries', rationale: 'Reranking every query gives the best quality but costs CPU/GPU at scale. Caching the rendered SERP for the head of the query distribution (millions of queries account for a third of traffic) cuts the heavy work to a fraction. The trade is freshness: cache TTL must be short for news-sensitive queries and longer for evergreen ones.' },
      { decision: 'Personalization on by default vs anonymous default', rationale: 'Personalization-on lifts CTR and engagement (people like results tuned to them). But it raises privacy concerns and creates the filter-bubble criticism. Anonymous default is more defensible publicly, lifts user trust, and keeps the system simpler; explicit opt-in to personalization is the modern compromise.' },
      { decision: 'In-memory index vs SSD-backed', rationale: 'In-memory gives microsecond posting-list reads but requires enough RAM to hold the index per shard; at petabytes total this means thousands of servers. SSD-backed cuts hardware cost ~5× but adds millisecond-class read latency that eats the p99 budget for multi-term queries. Production uses tiered storage: hot posting lists in RAM, long-tail terms on SSD with prefetching.' },
    ],
    keyTakeaways: [
      'The inverted index is the central data structure; sharding it document-wise is what makes web-scale search possible',
      'Two-stage retrieval — fast L0 on every shard, heavy ML rerank on top candidates — is how 200ms latency coexists with deep learning',
      'PageRank, BM25, and anchor text remain the load-bearing classical signals beneath the modern ML layer',
      'Freshness comes from a Caffeine-style incremental pipeline alongside the batch rebuild — neither alone is sufficient',
      'The hot-query cache absorbs a huge fraction of traffic at almost no cost; design for it from day one',
      'Quality is measured by user behavior (CTR, click-back, reformulation) and ratified by human raters; no change ships without statistically significant wins',
    ],
    faqs: [
      { question: 'Why does Google use document-partitioned index instead of term-partitioned?', answer: 'Two reasons. First, document-partitioned scales naturally as the document count grows — add a shard, index 1/(N+1) of new docs into it. Term-partitioned needs to redistribute terms when the term set grows or query patterns shift. Second, hot terms ("the", "a") create hot shards in term-partitioning; document-partitioning spreads load evenly because every query fans out to every shard. The fan-out cost feels expensive but is amortized: a multi-term query had to read multiple shards anyway.' },
      { question: 'How does the system serve a query in under 200ms when it has to consult thousands of shards?', answer: 'Parallel fan-out and aggressive timeouts. Root issues all shard queries concurrently. Each shard runs the same simple BM25 + L0 model and returns its local top-K. Root merges as shards reply; once it has enough high-confidence candidates (or hit the latency budget), it cuts off slow shards and proceeds with what it has. Tail latency is the enemy; a shard that takes 500ms gets dropped and its missing results are accepted as the cost of speed. Hot-query cache short-circuits the entire pipeline for popular queries.' },
      { question: 'What is the actual difference between PageRank and modern ML rankers?', answer: 'PageRank is a single number per page derived from the global link graph — basically "how authoritative is this page." It is fixed per page until recomputed. Modern ML rankers compute a score per (query, page) pair using hundreds of features that include PageRank, BM25, query intent, user signals, and many learned embeddings. PageRank is one of the features inside the modern ranker, not a replacement. The ML model adds context: a page might be authoritative in general (high PageRank) but irrelevant to this specific query.' },
      { question: 'How does Google detect and demote spam?', answer: 'Layered defenses. Link-graph analysis: unnatural link patterns (cliques, sudden link spikes from low-quality domains) get the receiving page\'s PageRank discounted. On-page analysis: keyword stuffing, hidden text, doorway-page patterns are classified by content models. Topical relevance: pages whose visible content does not match their anchor-text claims get penalized. Manual review for new domains. Penalties propagate: links from penalized domains count for nothing. The arms race is constant; Google publishes quality guidelines, and persistent spammers eventually get manually de-indexed.' },
      { question: 'How fresh is the index — when does a new news article appear in results?', answer: 'For news, minutes. The incremental indexing pipeline (Caffeine-style) prioritizes URLs from known news sources, indexing within seconds of fetch and adding to a fresh-segment that leaves serve alongside the main index. For ordinary new pages, hours to a day depending on the crawl priority assigned by the URL frontier. For long-tail pages discovered by a slow crawl, days. The full main index rebuild happens nightly or weekly; freshness in between comes entirely from incremental segments.' },
      { question: 'What is the role of BERT and large language models in modern search?', answer: 'BERT is used for query understanding (semantic intent, disambiguation) and final-stage reranking. Query understanding: a BERT-style model maps the query to an embedding that captures meaning beyond the literal terms, useful for "what is the temperature in San Francisco" vs "weather sf" — both should hit the same intent. Reranking: top ~100 candidates from the L1 reranker get a score from a deep model that considers query-document semantic similarity. LLMs (like Gemini in Google\'s SGE) generate summary answers above the SERP for some queries — a layered shift from "give links" to "give answer with citations."' },
      { question: 'How do you balance freshness vs authority for the same query?', answer: 'Query classification. The ranker learns from data which queries are freshness-sensitive (news, sports scores, stock prices) and which are evergreen (definitions, recipes, historical facts). Freshness signals get a high weight for the former, low weight for the latter. The training data is human-rated queries plus user-behavior signals — if users on "Trump speech" want today\'s results, that gets baked into the freshness weight for similar queries. Wikipedia\'s "France" page wins on evergreen queries despite being old; a 4-minute-old AP wire wins on breaking news.' },
      { question: 'Why is the snippet returned with each result, and how is it generated?', answer: 'The snippet helps the user decide whether to click; the right snippet doubles click-through compared to a bad one. Generation: the forward index (doc_id to list of terms with positions) is read for the top results. A snippet extractor finds the best 1–2 sentences containing the query terms, preferring sentences with multiple terms close together. For pages with structured data (recipes, products), the snippet may show that instead of free text. Snippet generation runs after ranking, only for the top 10–20 candidates, to keep it cheap.' },
      { question: 'How much does query personalization actually change results?', answer: 'Less than people imagine. Personalization is a final-stage reranking step that nudges the top-10 order based on recent searches and a few coarse signals (location, language, device). It does not change the candidate pool. For most queries the personalized SERP differs from the anonymous SERP by 0–2 positions in the top 10. Where it matters: ambiguous queries ("Apple" — fruit or company?) and local-intent queries ("pizza"). The filter-bubble concern is real for sensitive topics but heavily mitigated by the fact that personalization is a soft, narrow signal.' },
      { question: 'How is search quality measured, and how do you know a change is actually an improvement?', answer: 'Two methods that must agree. Quantitative: A/B test the change against the current algorithm on real traffic, measure CTR on top results, click-back rate, time-to-first-click, query-reformulation rate. Statistical significance required across multiple metrics. Qualitative: human raters score sampled queries against the SERP using detailed guidelines (relevance, authority, freshness); the aggregated rater scores produce an NDCG number per algorithm variant. Neither alone is enough — engagement metrics can reward sensationalism, rater scores can miss user reality. Both must show improvement to ship.' },
    ],
  },
  {
    id: 24,
    slug: 'design-autocomplete',
    title: 'Design Typeahead / Autocomplete',
    difficulty: 'Medium',
    category: 'Search',
    tags: ['trie', 'autocomplete', 'ranking', 'caching', 'real-time'],
    problemStatement: `Design a typeahead suggestion system that shows the top 5 query completions as a user types. Target: Google Search scale — trillions of searches processed to build suggestions, 10B suggestion requests/day.`,
    requirements: {
      functional: ['Return top 5 completions for a prefix in < 100ms', 'Suggestions ranked by search frequency', 'Update suggestions as new search trends emerge', 'Support multiple languages'],
      nonFunctional: ['< 100ms P99 suggestion latency', '10B requests/day ≈ 115K rps', 'Near-real-time trend updates (< 1hr lag)', 'Low server cost (heavy caching)'],
    },
    capacityEstimates: `115K rps\nTop 10K prefixes cover ~90% of requests\nCache top 10K prefixes → ~10K × 5 suggestions × 50B = 2.5MB in memory\nFull trie: 5M unique prefixes × 50B = 250MB`,
    solutionBreakdown: [
      { section: 'API and User Experience Constraints', content: 'GET /suggest?q={prefix}&lang={lang}&k=5 returns up to 5 completions ranked by likely-intent. The endpoint is hit on every keystroke, so it must respond in well under 100ms p99 — past that, users perceive lag and may type past the suggestion they wanted. Client-side debounce of ~50ms (one keystroke worth) cuts the QPS we have to handle without hurting UX.\n\nResponse payload is tiny: 5 strings plus tracking ids, well under 1 KB. The endpoint is gzip-compressed, cacheable per locale, and served from the closest POP. Importantly the response is a hint, not a decision — the user can still type whatever they want and submit it as a search.' },
      { section: 'Trie Structure with Precomputed Top-K', content: 'A trie where each character is a node, and each node stores the precomputed top-K completions for the prefix ending at that node. Lookup walks the trie character by character (O(prefix_length)) and returns the stored top-K — no aggregation, no list merging.\n\nEach node holds [completion_string, score, metadata] tuples for the top 5–10 candidates. The metadata supports later filtering (NSFW flag, region restriction). The trie is read-only at serving time; updates come from a rebuild process. Memory is the main cost — a trie indexing 5M unique prefixes at ~50 bytes per node is ~250 MB.' },
      { section: 'Scoring and Ranking Inputs', content: 'Multiple signals combined into one score per query. (1) Raw frequency: how many times this query has been searched in the past N days. (2) Recency weighting: exponential decay so a 1-day-old search counts ~10x a 30-day-old one. (3) CTR: of users shown this completion, how often did they click it. (4) Conversion / dwell: did the click result in a satisfied session.\n\nScore = log(freq) × recency_decay × CTR. The logarithm prevents one viral query from drowning everything else. For typed search rather than autocomplete, this score is the basis of the global "popular query" ranking; the trie shards it by prefix.' },
      { section: 'Offline Trie Build Pipeline', content: 'Source: search query logs streamed into a daily/weekly batch job (Spark or Beam). Stages: (1) clean and normalize (lowercase, trim, strip personally identifiable data), (2) aggregate by query → count, (3) join with engagement signals (CTR), (4) compute final score, (5) for every prefix of length 1..30 of every query in the score table, emit (prefix, query, score), (6) reduce by prefix to keep only top K per prefix, (7) build the trie data structure and serialize to a compact binary format.\n\nThe binary trie format is mmap-friendly: serving nodes mmap the file and serve directly from page cache. Build runs nightly; new tries promote via blue/green load — a serving node loads the new trie alongside the old, warms it, then atomically swaps.' },
      { section: 'Sharding and Serving Layout', content: 'Trie shards by first 1–2 characters of the prefix. Common letters (s, a, t) get their own shards; rare letters share. About 50 shards covers English. Each shard fits in ~5 GB of RAM, loadable on a single mid-size VM. The router computes the shard from the first character of the query and dispatches.\n\nReplicas: 3-way replication per shard for redundancy. A health check pings each replica every second; a failing replica is removed from the LB. Per-shard QPS at peak ~3K/sec; one CPU core handles this trivially. The bottleneck is rarely CPU — it is cold-start time when loading a new trie snapshot.' },
      { section: 'Hot Prefix Cache', content: 'The top ~10K most-typed prefixes account for ~90% of suggestion traffic. Cache the full top-K response for these prefixes in Redis (or in a per-edge cache at the CDN) with a short TTL (60 seconds during day, 5 minutes at night). Cache hit serves from memory in <5ms with no trie lookup.\n\nCache warming: at build promotion time, populate the cache from the trie for the known hot prefixes. Cache invalidation: TTL-only — we accept slightly stale suggestions for the head of the distribution. The cache is keyed by (prefix, locale) so users in different locales get appropriate results.' },
      { section: 'Real-Time Trending Boost', content: 'A separate streaming job (Flink) reads from the same Kafka query-log stream and computes a sliding-window count over the last hour. Top trending queries (high growth rate, not just high count) are published to a Redis sorted set keyed by region.\n\nAt query time, the suggestion server merges the trie\'s top-K with the trending top-K — trending items get a score boost so they appear at positions 1–2 if they are surging. Boost decays as the query falls off the trending list. This is how "Olympic medal results" or "election results" appear in suggestions within minutes of becoming hot.' },
      { section: 'Personalization Layer', content: 'For signed-in users, recent personal queries are mixed into the suggestion list with a modest boost. Implementation: per-user recent-queries cache (last 100 queries) in Redis keyed by user_id. At query time, if the user is signed in, fetch their recent queries, filter to those starting with the current prefix, and inject the top 1–2 into the suggestion list.\n\nPersonalization is a layered add-on; it never replaces the global trie results, only nudges them. Privacy: the recent-queries cache is encrypted, has a 30-day TTL, and is deletable on user request. For signed-out sessions, no personalization signals are stored beyond an in-session client-side cache.' },
      { section: 'Localization and Language Detection', content: 'Each (locale, language) has its own trie. The user\'s locale is detected from headers, cookies, or signed-in preferences. A US English user typing "tor" gets "tornado warning"; a UK user typing the same prefix gets different results.\n\nMixed-language users: a language router checks the prefix against multiple-language tries and merges the candidates ranked by user-history language preferences. Some scripts (Chinese, Japanese, Korean) need special tokenization — the trie operates on Unicode codepoints, not bytes, and Pinyin/Romaji prefix matching is a separate sub-system that adds complexity.' },
      { section: 'Anti-Abuse and Quality Filters', content: 'The autocomplete is highly visible; problematic suggestions cause real PR and policy issues. Filters: a blocklist of slurs, illegal-content categories, and known manipulation campaigns; a classifier that flags suggestions matching policy categories (violence, self-harm, public-figure defamation).\n\nFiltering runs at build time (suggestions never enter the trie if blocked) and at serve time as a safety net (in case the blocklist updated after the build). For named individuals there are specific rules: defamatory completions about a real person are removed by ML classifiers plus a manual review queue. This is the area where autocomplete generates the most operator workload.' },
      { section: 'Latency Optimization', content: 'Hard p99 budget ~80ms. Where time goes: TLS handshake (cached after first request), DNS (cached), trie lookup (<1ms on a hot shard), JSON serialize and gzip (<2ms), network. The dominant factor is network RTT to the nearest POP.\n\nOptimizations: HTTP/2 multiplexing so multiple keystroke requests share a connection. Edge POPs in 50+ cities so RTT is sub-30ms for most users. Server-Timing headers to identify which subsystem is slow. Per-shard timeout of 50ms; on timeout, serve from the cache or return an empty array rather than blocking the user.' },
      { section: 'Failure Modes and Graceful Degradation', content: 'Trie shard offline: router fails over to a replica. All replicas offline (rare): the router returns the cached top-K for the prefix if available; otherwise returns an empty list rather than an error. The user just sees no suggestions — annoying but not broken.\n\nCache (Redis) offline: trie serves directly. Slower per-request but functional. Build job fails: the previous day\'s trie continues to serve. Suggestions become slightly stale but the system stays up. The pattern is "degrade quality before breaking availability." A search box with no suggestions is fine; one that hangs is unforgivable.' },
      { section: 'Observability and Quality Metrics', content: 'Latency: per-shard p50/p99, per-prefix-length p99. Cache: hit ratio per region. Quality: CTR per suggestion position (does the user click suggestion 1? if not, why are we showing it?), reformulation rate (user typed past the suggestion). Volume: QPS per locale, top prefixes by traffic.\n\nA/B tests on scoring formula changes drive the ranking. Sample queries get rated by humans for relevance. Alerts on suggestion CTR drop in a region (the recent build is worse), trie build failure, hot-prefix cache hit ratio drop (something just changed the query distribution).' },
    ],
    diagram: `graph TB
    subgraph Clients
        Browser[Browser Search Box]
        Mobile[Mobile App]
        Voice[Voice Assistant]
    end
    subgraph Edge
        CDN[CDN Edge]
        LB[Load Balancer]
    end
    subgraph Gateway
        APIGW[Suggestion API]
        RL[Rate Limiter]
    end
    subgraph Services
        Router[Prefix Shard Router]
        TrieShardA[Trie Server Shard A]
        TrieShardB[Trie Server Shard B]
        TrieShardC[Trie Server Shard C]
        Personalizer[Personalization Layer]
        LangSvc[Language Router]
        TrendBoost[Trending Booster]
    end
    subgraph Async
        Kafka[Search Log Stream]
        SparkBatch[Spark Batch Scoring]
        FlinkStream[Flink Sliding Window]
        TrieBuilder[Trie Snapshot Builder]
        CacheWarmer[Hot Prefix Cache Warmer]
    end
    subgraph Storage
        HotCache[(Redis Top 10K Prefixes)]
        TrieSnapshot[(Trie Snapshot S3)]
        FreqDB[(Frequency Score DB)]
        TrendStore[(Trending Counts Redis)]
        UserProfile[(User History Store)]
    end
    subgraph Analytics
        EventBus[Query Events Bus]
        Lake[(Data Lake)]
    end

    Browser -->|type prefix| CDN --> LB --> APIGW
    Mobile --> APIGW
    Voice --> APIGW
    APIGW --> RL
    APIGW --> LangSvc
    APIGW --> HotCache
    HotCache -->|miss| Router
    Router --> TrieShardA
    Router --> TrieShardB
    Router --> TrieShardC
    TrieShardA --> TrieSnapshot
    TrieShardA --> Personalizer --> UserProfile
    TrieShardA --> TrendBoost --> TrendStore
    Personalizer --> APIGW
    APIGW --> Browser

    Browser -->|search submitted| EventBus --> Kafka
    Kafka --> SparkBatch --> FreqDB
    FreqDB --> TrieBuilder --> TrieSnapshot
    TrieSnapshot --> TrieShardA
    TrieSnapshot --> TrieShardB
    TrieSnapshot --> TrieShardC

    Kafka --> FlinkStream --> TrendStore
    EventBus --> Lake
    HotCache --> CacheWarmer

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class HotCache,TrieSnapshot,FreqDB,TrendStore,UserProfile storage
    class Kafka,SparkBatch,FlinkStream,TrieBuilder,CacheWarmer async
    class CDN,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Trie with precomputed top-K vs query-time aggregation', rationale: 'Precomputed top-K at each trie node makes lookup O(prefix_length) with no aggregation cost — the right choice for sub-100ms latency. Query-time aggregation (fetch all matching queries, score them now) gives more flexibility (personalization, freshness boosts) but blows the latency budget. Hybrid: trie for the global candidates, separate query-time blending for personalization and trending.' },
      { decision: 'Daily trie rebuild vs streaming updates', rationale: 'Daily rebuild is operationally simple and lets you re-derive scores from scratch with the latest weighting. Streaming updates (apply individual query log events to the live trie) keep freshness measured in seconds but make the trie a moving target — harder to debug and to A/B test. Most systems do batch with a trending layer on top to get both freshness and stability.' },
      { decision: 'Personalization on by default vs anonymous default', rationale: 'Personalization lifts engagement on signed-in users but stores extra data and creates a privacy attack surface. The reasonable default: personalization on for signed-in users with explicit consent disclosed, off for signed-out sessions, easy to disable. Compute personalization at request time from the user-recent-queries cache; never bake personal data into the global trie.' },
      { decision: 'Edge-cached suggestions vs origin-only', rationale: 'Edge-cached cuts latency to sub-30ms and offloads massive QPS from origin, but cache invalidation for personalization or moderation pulls is hard. Origin-only keeps suggestions fresh but burns RTT and CPU. The practical answer: edge-cache the anonymous top-K per locale with short TTL; serve personalization from origin. Most queries hit the cache; the few that need personalization pay the round-trip.' },
      { decision: 'Block-list filtering at build time vs serve time', rationale: 'Build time is cheap and bulletproof (bad suggestions never reach serving) but cannot react to new policy decisions until the next build. Serve time catches the long tail and lets you react in minutes to a viral issue, but adds a filter pass to every request. Do both: build-time eliminates 99% of the problem; serve-time is the safety net for rapidly added items.' },
    ],
    keyTakeaways: [
      'Storing the top-K completions at each trie node turns serving into a pointer walk — no aggregation at query time',
      'The hot-prefix cache covers most traffic at near-zero cost; design the cache as primary, the trie as fallback',
      'Real-time trending is a separate streaming sub-system that blends with the batch trie at request time',
      'Personalization is a final blend, never a replacement for the global ranking — preserves privacy and quality',
      'Anti-abuse filtering must run at both build time and serve time; suggestions are too visible to leave to chance',
      'Graceful degradation matters more than peak quality — an empty suggestion list is fine, a hung search box is unacceptable',
    ],
    faqs: [
      { question: 'Why precompute top-K at each trie node instead of aggregating at query time?', answer: 'Because the latency budget is brutal — 100ms p99 for an endpoint hit on every keystroke. If you aggregated at query time you would walk the trie to a node and then enumerate every completion in its subtree, sort by score, and pick top-K. For a popular prefix that subtree could contain tens of thousands of completions; the sort alone blows the budget. Precomputed top-K turns serving into a fixed-cost pointer walk regardless of how popular the prefix is. The build is more expensive, but build runs nightly and serving runs billions of times per day; the asymmetry is the whole point.' },
      { question: 'How often does the trie get rebuilt, and why not just stream updates into the live trie?', answer: 'Rebuild is nightly for most systems. Streaming updates are doable but they make A/B testing and quality measurement hard — the trie is a moving target so two queries an hour apart get different rankings. Nightly rebuild gives you a stable artifact, easy diffing between versions, and clean rollback when a new build hurts CTR. Real-time freshness comes from the trending layer (Flink sliding window) that overlays the trie at request time, not from streaming into the trie itself.' },
      { question: 'How do you handle the trending boost without making suggestions feel jumpy?', answer: 'The trending layer publishes a sorted set per region with growth rate, not raw count. Items must have a sustained growth signal over multiple windows before they get boosted into the trie merge. The boost is a multiplier on the score, capped so it cannot overwhelm a well-established top result for a stable prefix. The boost decays smoothly as growth flattens. This avoids the pathology where one minor news event yanks every prefix\'s suggestions for a few hours.' },
      { question: 'What is the actual memory cost of the trie at Google-scale?', answer: 'Conceptually: ~5M unique prefixes, each node about 50 bytes plus ~5 pointers to top completions, so ~250 MB per language. Add 50 languages and you are at ~12 GB total. Sharded by first character, no single node holds the whole thing — each serving instance loads its assigned shard (~5 GB max). Modern serving uses memory-mapped binary tries so the file is paged in by demand; cold parts of the trie do not even consume RAM until accessed. The practical limit is not memory but cold-start time when loading a fresh snapshot.' },
      { question: 'How do you keep latency under 100ms when the user is on slow mobile?', answer: 'Network is the dominant cost. Edge POPs in 50+ cities push the worst-case RTT to ~30ms even on cellular. HTTP/2 keepalive avoids per-request handshake. Response is small (under 1KB gzipped) so even a slow connection finishes the body in tens of ms. Client-side debounce by ~50ms collapses bursts of keystrokes into one request. On a flaky connection, the client may keep showing the previous suggestions while waiting for the new ones to arrive — that is fine product behavior, never block the UI on the network.' },
      { question: 'How do you prevent autocomplete from suggesting harmful or defamatory things?', answer: 'Layered defense. (1) Build-time blocklists strip suggestions matching slur lists, illegal-content categories, and known manipulation campaigns. (2) ML classifiers tag suggestions matching policy categories (violence, self-harm, defamation about named individuals); high-confidence matches are dropped. (3) Manual review queue for borderline cases — operators can blacklist specific (prefix, completion) pairs that the ML missed. (4) Public reporting mechanism lets users flag bad suggestions. The blacklists are updated in minutes and applied as a serve-time filter so the change is visible without waiting for the next build.' },
      { question: 'How does this differ from a search engine query — could you not just use Elasticsearch?', answer: 'Elasticsearch can do prefix completion (the completion suggester is a prefix-trie under the hood) but the per-query cost is much higher because ES runs a full query pipeline including caching, scoring, and merging across shards. For an endpoint hit billions of times per day, a custom trie service is 10–100× cheaper per request than ES. Use ES if you need fuzzy matching, mid-string search, or the same data is already there for other queries. Use a custom trie if you need millisecond serving at billion-QPS scale on tiny payloads.' },
      { question: 'How would you build autocomplete for languages with non-alphabetic input (Chinese, Japanese, Korean)?', answer: 'Two layers. Native script: the trie operates on Unicode codepoints, which works fine for Chinese and Japanese; the user types a character and the trie walks to that node. Phonetic input: many users type Pinyin (for Chinese) or Romaji (for Japanese) which must be converted to the target script before lookup. A separate phonetic-to-character mapper turns "beij" into candidates "北京", "贝吉", etc., each of which is then looked up in the native trie. The mapper itself is a small finite-state transducer; for Japanese it must be context-aware because the same romaji can map to several kana sequences.' },
      { question: 'What happens if the suggestion ranking model changes — how do you ship the new ranking safely?', answer: 'A/B test. Build two tries in parallel using the old and new ranking formulas. Route 1% of traffic to the new trie; measure CTR per suggestion position, reformulation rate, latency. If new wins on quality and ties on latency, ramp to 5%, 20%, 100% over a week. Rollback the moment a quality regression appears. Each step is gated by the metrics; ranking changes are too high-leverage to ship without measurement. Most ranking changes fail to win on metrics, which is why this discipline exists.' },
      { question: 'Is there any state on the client side that affects suggestions?', answer: 'A small client-side cache of recent personal queries can be added if you want personalization without round-tripping for it — the client merges its recent queries into the server\'s suggestion list before display. Useful in privacy-focused contexts. Otherwise the client is stateless beyond TLS session tickets and HTTP/2 connection state. Local debounce and showing the previous suggestion while a new one is in flight are client behaviors that affect UX but not the data on the server.' },
    ],
  },
  {
    id: 25,
    slug: 'ecommerce-product-search',
    title: 'Design E-commerce Product Search',
    difficulty: 'Medium',
    category: 'Search',
    tags: ['search', 'elasticsearch', 'facets', 'ranking', 'personalization'],
    problemStatement: `Design the product search system for an e-commerce platform like Amazon. Users search by keyword and filter by category, price, brand, ratings. Results must be ranked by relevance and personalized for the user.`,
    requirements: {
      functional: ['Keyword search across product catalog', 'Filter by category, price range, brand, ratings', 'Sort by relevance, price, rating, newness', 'Personalized ranking based on user history', 'Autocomplete for product names'],
      nonFunctional: ['< 200ms search response', '1B products in catalog', '100K search queries/sec', 'Near-real-time index updates for new products/price changes'],
    },
    capacityEstimates: `1B products × 2KB avg document = 2TB raw\nElasticsearch index with compression ≈ 600GB\n20-shard cluster, 30GB per shard`,
    solutionBreakdown: [
      { section: 'Search API and Response Shape', content: 'GET /search?q={text}&category=&price_min=&price_max=&brand=&sort=&page=&user_id= returns { hits: [{product_id, title, price, image_url, rating, why_ranked}], facets: { category: [{name, count}], brand: [...], price_histogram: [...] }, total_count, debug_token }. The why_ranked field is internal-only, used for ranking debugging and to expose ranking signals to product teams.\n\nResponse is paginated (24–48 items per page, never deep pagination — past 1000 results the long tail is irrelevant). The endpoint is the same for autocomplete-driven category landing pages, search-results pages, and the homepage personalized rail; query parameters control the mode.' },
      { section: 'Document Model in Elasticsearch', content: 'Each product is one document with fields tuned for retrieval and ranking. Text fields: title (analyzed with custom analyzer, boosted 3x), brand (analyzed + keyword sub-field), description (analyzed, boosted 0.5x), bullet_points (analyzed). Categorical: category_id (keyword), department (keyword), seller_id (keyword), color (keyword). Numeric: price (scaled_float), rating (float), reviews_count (integer), stock_count (integer). Date: launch_date.\n\nNested objects for variants (size, color, SKU) so a single document represents a product family. Synonym sets ("sneaker" → "trainer" → "athletic shoe") are applied at index time via custom analyzers and at query time for query expansion. The schema is the contract that ranking depends on; changing it requires a full reindex.' },
      { section: 'Query Pipeline', content: 'A search request flows through: query parser (tokenize, detect language, classify intent) → spell suggester (did-you-mean) → query rewriter (synonym expansion, brand canonicalization) → Elasticsearch query DSL builder → ES execute → re-ranker → response shaper.\n\nThe ES query is structured as a bool query: must (keyword match on title, brand, description with field boosts), filter (category, price range, brand, in-stock — these are bitset operations and very cheap), should (boost-by-popularity, boost-by-rating, boost-by-personal-affinity). Filters drastically reduce the candidate set before the heavy scoring runs.' },
      { section: 'Ranking Layers: BM25, Business Rules, ML Reranking', content: 'Three layers. (L0) Elasticsearch BM25: keyword match score over title and description fields with field boosts. Returns top ~1000 candidates per query in ~30ms. (L1) Business rules: in-stock penalty, promoted products boost, profit-margin boost, seller-quality boost. Applied via function_score in the ES query. Returns top ~200 candidates with shop-friendly score adjustments.\n\n(L2) ML re-ranking with LambdaMART (gradient-boosted decision tree) on hundreds of features: query-product semantic similarity (sentence embedding cosine), CTR for this product on similar queries, user-history match (affinity scores per category/brand), time-of-day, seasonality, price-vs-mean. Runs on top 200 candidates in ~30ms. Optional L3: a two-tower neural model for the top 50 to capture deeper semantic patterns; skipped on low-margin queries to save GPU.' },
      { section: 'Faceted Navigation and Aggregations', content: 'Facets are computed in parallel with the main query as ES aggregations: terms agg on category, brand, color (top 10 per facet); histogram agg on price (logarithmic buckets); range agg on rating. The aggregations run over the filtered result set (so the "12 results in Electronics" count reflects current filters).\n\nFacets cost real CPU on Elasticsearch — they iterate the whole result set, not just top-K. For a query with millions of matches, facet computation can dominate latency. Mitigation: precompute facet counts for popular queries, sample-based aggregation for very broad queries, post-filter facets (apply the current filter set on top of precomputed counts where possible).' },
      { section: 'Personalization Inputs and Signals', content: 'Per-user features: recent category affinity (last 30 days clicks/purchases per category, exponentially decayed), brand affinity, price-band preference, device type (mobile users browse differently from desktop), location-derived inventory availability. Per-query-user features: has the user searched this query before, what did they click last time.\n\nFeatures are served from a feature store (online: Redis with ~1ms latency; offline: data lake for model training). At query time the re-ranker fetches the user feature vector and combines with the product features to compute personalized scores. Anonymous users get a generic feature vector; signed-in users get personalization within session and across sessions.' },
      { section: 'Indexing Pipeline: Catalog to Search', content: 'Catalog changes flow through Kafka. Producers: catalog DB CDC (Debezium on Postgres), price service events, inventory service events, review service updates. A consumer batches changes (every 1s or 500 events, whichever first) and calls ES bulk API. Bulk size ~5MB, with retry-on-conflict for concurrent updates.\n\nFreshness: price and inventory changes index within 30 seconds (critical for accuracy — showing an out-of-stock item kills CTR). New product launches index within a minute. Bulk catalog refresh (e.g., daily reprice) processes via a higher-throughput pipeline. Failed bulk writes go to a dead-letter queue with operator visibility — search staleness is a real customer-trust issue.' },
      { section: 'Cluster Topology and Sharding', content: '1B products at ~2KB per document compressed = ~600GB index. Split into 20 primary shards × 2 replicas = 60 total shards. Each shard ~30 GB, fits on one node. Cluster runs on 20–30 hot nodes with NVMe SSD.\n\nShard routing: by category_id hash, so queries restricted to a category hit fewer shards. For cross-category queries, all shards fan out — fine because BM25 scoring is shard-local and merging top-K from 20 shards is trivial. Routing also makes facet computation cheaper for category-scoped queries. A separate warm/cold tier holds deprecated/discontinued products for archival queries.' },
      { section: 'Latency Budget and Caching', content: 'Target p99 200ms. Where time goes: filter cache lookup (1ms), BM25 retrieval (30ms), facets (40ms), L1 business rules (5ms), L2 ML rerank (30ms), feature store fetches (10ms), network/serialization (50ms). Total ~170ms with headroom.\n\nFilter cache: Elasticsearch automatically caches frequently used filter bitsets (e.g., "category=Electronics AND in_stock=true"); cache hit makes the filter free. Hot query cache: full search response cached for ~1 minute for the very top queries, by-passing the whole pipeline (acceptable because prices may stale slightly but customers tolerate it). Personalized queries bypass hot-query cache.' },
      { section: 'A/B Testing, Ranking Evolution, and Experimentation', content: 'Every ranking change ships behind an A/B test. Traffic splits 50/50 (or 95/5 for risky changes); metrics tracked include CTR, conversion rate, revenue per session, refund rate (a critical late-stage metric — bad ranking causes bad purchases). Decisions require statistical significance over weeks for purchase-cycle products.\n\nMulti-armed bandit for fast iteration on small UI changes; standard A/B for ranking model changes. Holdout populations (a 1% slice that never sees experiments) provide long-term baseline. The challenge is multi-objective: a change that lifts CTR but drops revenue per session is usually a loss; the joint metric (often expected profit per query) is the goal.' },
      { section: 'Failure Modes and Resilience', content: 'ES shard offline: replicas serve transparently. Whole node offline: cluster rebalances; brief degradation. ES cluster offline (very rare): degrade to a catalog-DB fallback that serves rough text matches with no facets or ranking — ugly but availability over quality. Reindex partial failure: dead-letter queue + operator dashboard; stale documents flagged.\n\nFeature store outage: re-ranker falls back to non-personalized scores (the L1 output). Search still works; just less personalized. Inventory data stale: a periodic reconciliation job compares the index to the source-of-truth inventory and forces a re-index for any product whose stock_count diverges. The cardinal sin in e-commerce search is showing out-of-stock products as available — every safeguard targets this.' },
      { section: 'Observability and Search-Quality Metrics', content: 'System metrics: ES query latency p50/p99, indexer lag (Kafka consumer offset behind producer), facet computation p99, re-ranker timeouts. Business metrics: search → click rate, search → cart rate, search → purchase rate, zero-results rate (a high zero-result rate means the synonym table or category mapping is broken), refund rate per ranking version.\n\nQuality is measured weekly with human raters on sampled queries (NDCG, relevance ratings). The combination of engagement metrics + rater scores + revenue is the safety net against any one signal being gameable. The single most-watched metric: revenue per session — search is the path most users take to purchase, and a search that wastes their time costs money directly.' },
      { section: 'Adversarial and Quality Concerns', content: 'Seller-side adversaries try to manipulate ranking with keyword-stuffed titles, fake reviews, and brand-spoofing. Defenses: title length and quality scoring (penalize "BEST Headphones BLUETOOTH Wireless Sport Running Workout Premium Quality"), review-velocity anomaly detection (sudden spike in 5-star reviews = paid review ring, ML classifier on review text), brand-protection rules (exact-match brand searches surface authorized sellers first).\n\nFor counterfeits and policy violations, separate marketplace-trust signals downweight risky products. Manual review queue for new sellers. These are not "search" problems strictly, but search is where the ranking decision becomes visible to the customer — so the search team owns the integration.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Shopper[Web Shopper]
        MobileApp[Mobile App]
        VoiceAssist[Voice Search]
    end
    subgraph Edge
        CDN[CDN Static Assets]
        LB[Load Balancer]
    end
    subgraph Gateway
        APIGW[Search API]
        Auth[Auth Service]
    end
    subgraph Services
        QueryParser[Query Parser]
        AutoSug[Autocomplete Service]
        ESCluster[Elasticsearch Cluster]
        FacetSvc[Facet Aggregation]
        Ranker[LambdaMART Reranker]
        TwoTower[Two Tower Neural Model]
        BizRules[Business Rules and Promotions]
        InventoryCheck[In Stock Filter]
        SpellSvc[Spell Suggester]
    end
    subgraph Async
        Kafka[Catalog Change Events]
        BulkIndexer[Bulk Index Consumer]
        ClickStream[Click and Purchase Stream]
        ModelTrainer[Ranking Model Trainer]
        PriceUpdate[Price Inventory Updater]
    end
    subgraph Storage
        ESIndex[(Elasticsearch Index 20 shards)]
        Catalog[(Product Catalog DB)]
        UserProfile[(User Click History)]
        FilterCache[(Filter Bitset Cache)]
        ModelStore[(Ranking Model Store)]
        InventoryDB[(Inventory DB)]
    end
    subgraph Analytics
        EventBus[Behavioral Events]
        Lake[(Data Lake)]
        FeatureStore[Feature Store]
    end

    Shopper -->|keyword| CDN --> LB --> APIGW
    MobileApp --> APIGW
    VoiceAssist --> APIGW

    APIGW --> Auth
    APIGW --> AutoSug
    APIGW --> SpellSvc
    APIGW --> QueryParser --> ESCluster --> ESIndex
    ESCluster --> FilterCache
    ESCluster --> FacetSvc
    FacetSvc --> APIGW

    ESCluster -->|top 200| Ranker
    Ranker --> TwoTower --> FeatureStore
    Ranker --> UserProfile
    Ranker --> BizRules
    Ranker --> InventoryCheck --> InventoryDB
    Ranker --> APIGW
    APIGW --> Shopper

    Catalog --> Kafka --> BulkIndexer --> ESCluster
    InventoryDB --> PriceUpdate --> ESCluster

    Shopper -->|click or buy| ClickStream --> EventBus
    EventBus --> Lake --> ModelTrainer --> ModelStore --> Ranker
    Lake --> FeatureStore

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class ESIndex,Catalog,UserProfile,FilterCache,ModelStore,InventoryDB storage
    class Kafka,BulkIndexer,ClickStream,ModelTrainer,PriceUpdate async
    class CDN,LB edge
    class EventBus,Lake,FeatureStore analytics`,
    tradeoffs: [
      { decision: 'Elasticsearch vs Solr vs custom inverted index', rationale: 'Elasticsearch wins on developer ergonomics (REST API, query DSL, ecosystem) and operational maturity. Solr is similarly capable but the community is shrinking; new builds default to ES. Custom inverted index is faster for narrow query patterns but takes years to match ES feature-for-feature (faceting, suggester, ranking functions, percolator). Use ES unless your QPS or schema flexibility legitimately outgrows it.' },
      { decision: 'BM25 alone vs heavy ML re-ranking', rationale: 'BM25 alone is fast and predictable but ignores user-product affinity and modern relevance signals. ML re-ranking on top-200 candidates lifts conversion by single-digit percentages (huge for revenue) at the cost of feature engineering, model serving infrastructure, and ongoing retraining. For any platform with serious search-driven revenue, ML re-ranking pays for itself.' },
      { decision: 'Personalization on by default vs explicit opt-in', rationale: 'Personalization on lifts conversion because users see products they actually want. Explicit opt-in is more defensible on privacy grounds but cuts the lift dramatically because few users opt in. The mainstream compromise: anonymous personalization based on session behavior is on by default (low privacy concern); cross-session personalization requires sign-in. Disclosure in account settings.' },
      { decision: 'Sync indexing on every write vs micro-batched indexing', rationale: 'Sync indexing (write to DB and ES atomically) gives perfect consistency but couples ES uptime to write availability and bottlenecks on ES bulk API. Micro-batched (CDC into Kafka, indexer flushes every second) decouples and is the production norm — 1-second staleness is acceptable for almost all e-commerce. The only case for sync: a flash sale where price changes must be visible instantly across all surfaces.' },
      { decision: 'Single global ES cluster vs per-region', rationale: 'Single global gives one source of truth for ranking but cross-region query latency punishes far users. Per-region clusters reduce latency to <100ms RTT and give regional failover but require synchronizing the index (CDC fans out to each region). For multi-region commerce (Amazon-scale), per-region with shared CDC pipeline is the standard.' },
    ],
    keyTakeaways: [
      'Filters run before scoring in Elasticsearch and are cached as bitsets — putting category/brand/price in the filter clause is the difference between a fast and a slow search',
      'BM25 retrieval to ~1000 candidates then ML re-ranking on top-200 is the modern recipe — full ML on all candidates is unaffordable',
      'Personalization is a final reranking nudge based on user affinity features served from a feature store; it never replaces base relevance',
      'Index freshness within 30 seconds via Kafka-driven incremental indexing — showing out-of-stock as available kills trust and CTR',
      'Facets must be aggregated on the filtered result set, which costs real CPU on broad queries; precompute or sample for the heaviest cases',
      'Search quality is a multi-objective optimization (CTR, conversion, revenue per session, refund rate) — no single metric is safe to optimize alone',
    ],
    faqs: [
      { question: 'Why are filters faster than queries in Elasticsearch?', answer: 'Filters operate as boolean bitsets — each filter clause produces a set of matching doc_ids. Elasticsearch caches these bitsets in memory, so a repeated filter ("category=Electronics AND in_stock=true") is just an AND of cached bitsets, which costs microseconds. Queries (must clauses) require scoring each candidate document against the query, which is much more expensive. The lesson: anything that is structural (category, brand, in-stock, price range) goes in the filter; only the user\'s typed text and ranking signals belong in the must clause. This pattern alone can speed up searches 10x.' },
      { question: 'How does the system know that "sneaker" and "trainer" should match the same products?', answer: 'Synonym sets, defined per locale. UK English has trainer ↔ sneaker, US English has tennis shoe ↔ sneaker. These are encoded in custom Elasticsearch analyzers applied at index time (so "trainer" in a UK product title indexes as both forms) and at query time (so a US user searching "sneaker" matches UK-sourced "trainer" listings). Synonyms are also expanded by an ML model trained on co-clicks: if users who type query A click on products that match query B, A and B are candidate synonyms. The synonym list is updated weekly and reviewed by merchandising before changes ship.' },
      { question: 'Why use Elasticsearch instead of just searching the product database with LIKE %term%?', answer: 'Three reasons. (1) Scale: at a billion products, a LIKE query is a full table scan per search; ES does it via inverted index in milliseconds. (2) Relevance: SQL has no concept of BM25 ranking; ES does. (3) Faceting: SQL aggregations on millions of rows per query are slow; ES is built for this. The simple SQL approach works up to maybe 100K products with low traffic; beyond that, you need a search engine. Elasticsearch is the boring, correct choice.' },
      { question: 'How fresh is the search index — if I change a price, when does the customer see it?', answer: '30 seconds end-to-end in the common case. The catalog DB writes the new price → Debezium emits a CDC event → Kafka producer batches it → indexer consumer reads (every second) → ES bulk API indexes (sub-second). For a flash sale where prices change in real-time, a parallel fast-path bypasses batching and writes directly via a low-latency lane. Inventory follows the same path. The slowest case is large bulk updates (10K+ products changing at once) where the indexer queue depth grows; the dashboard surfaces this lag.' },
      { question: 'How do you stop sellers from gaming the search ranking?', answer: 'Several anti-manipulation layers. Title-quality scoring penalizes keyword-stuffed titles ("BEST WIRELESS BLUETOOTH HEADPHONES RUNNING SPORT GAMING WORKOUT"). Review-velocity anomaly detection catches suspicious 5-star bursts and an ML model flags AI-generated review text. Brand-protection rules surface authorized sellers first on exact-match brand searches, demoting third-party listings that try to ride on the brand. Penalty signals for products with policy violations propagate to the ranking model. The most aggressive offenders get manual de-listing; the long tail is handled by the ML classifiers.' },
      { question: 'Why does personalization use a feature store instead of computing features at request time?', answer: 'Features come from many sources: recent clicks (last 30 days, decayed), historical purchases, category affinity, brand affinity, price-band preference, device-derived signals. Computing each from scratch on every search would cost too much. The feature store precomputes these for every active user, updates them in near-real time as the user clicks/buys, and serves them from Redis in <1ms. At request time the re-ranker does one feature-store lookup, multiplies user-feature vector by product-feature vector, and gets a personalization score. Pre-computation is the only way to keep total search latency under 200ms with personalization on.' },
      { question: 'How do you handle a query that returns zero results?', answer: 'Multiple fallbacks. First, query rewriting: if "wireless gaming headphones blue" returns zero, drop the least restrictive constraint (color: blue) and retry. If still zero, drop further. Second, did-you-mean: a spell-checker often catches typos that caused the zero result. Third, related products: show top products in the closest category as a "no exact match, but you might like..." panel. Fourth, anomaly tracking: a sudden spike in zero-result queries usually indicates a broken synonym or a category mapping problem; ops gets a page. Empty SERPs are a conversion killer; eliminating them is the single highest-leverage quality improvement.' },
      { question: 'How does the system handle deep pagination — say a user wants page 100?', answer: 'It mostly does not. Past page ~20 the result quality degrades to noise, and the cost of computing page 100 is high (Elasticsearch must aggregate top-2400 candidates and skip 2399). We cap pagination at a hard limit (often 1000 results) and surface "refine your search" guidance instead. For the rare legitimate deep-pagination need (catalog browse, sitemap generation), the API supports a separate scroll/cursor-based endpoint that does not pay the deep-pagination cost. This is also a small protection against scrapers who would otherwise crawl the full catalog cheaply via search pagination.' },
      { question: 'How do you keep search and inventory consistent across many regions?', answer: 'Regional Elasticsearch clusters with a shared CDC pipeline. Catalog and inventory updates publish to Kafka once; each region\'s consumer reads the topic and applies updates to its local ES cluster. Each region serves its own users from local data. Cross-region consistency is eventually consistent with sub-second lag typically; the system never aims to be cross-region linearizable because the value isn\'t worth the cost. For a flash sale we can boost the cross-region replication priority for the affected products.' },
      { question: 'How do you A/B test a ranking model change without hurting customer experience?', answer: 'Split traffic 50/50 (or 5/95 for riskier changes). Bucketed by user_id hash so a returning user sees a consistent variant. Metrics: CTR, conversion rate, revenue per session, refund rate (the late-stage signal that a bad ranking led to a bad purchase). Run for 1–2 weeks for statistical significance, longer for high-AOV products with long purchase cycles. Joint metric: expected profit per query, computed as engagement × purchase rate × margin minus return rate. Most ranking changes fail to win on the joint metric — which is why every change must be tested rather than shipped on intuition.' },
    ],
  },
  {
    id: 26,
    slug: 'design-payment-system',
    title: 'Design a Payment System',
    difficulty: 'Hard',
    category: 'Mobile & APIs',
    tags: ['payments', 'idempotency', 'acid', 'double-entry', 'reconciliation'],
    problemStatement: `Design a payment processing system that handles money transfers between accounts. Target: Stripe/PayPal scale — millions of transactions per day, zero tolerance for double-charges or lost payments, global compliance.`,
    requirements: {
      functional: ['Process payments (card, bank transfer)', 'Transfer money between accounts', 'Refunds and chargebacks', 'Payment status tracking', 'Webhooks for payment events'],
      nonFunctional: ['Exactly-once payment processing (no double charges)', '99.99% availability', 'PCI-DSS compliance', 'Idempotent APIs', 'Full audit trail'],
    },
    capacityEstimates: `1M transactions/day ≈ 12 txns/sec average\nPeak (Black Friday / launches): 50× ≈ 600 txns/sec\nStorage: ledger 1M × 400B = 400MB/day, append forever (~150GB/yr)\nFraud feature store: ~5KB per txn × 30-day window = ~150GB hot\nWebhook fan-out: ~3 outbound webhooks per txn = ~3K rps peak`,
    solutionBreakdown: [
      { section: 'API Design', content: 'Public surface (idempotent where it counts):\n  POST /payment_intents { amount, currency, customer_id, payment_method, capture: "automatic"|"manual" }\n  POST /payment_intents/{id}/confirm  (move PENDING → PROCESSING, run 3DS if required)\n  POST /payment_intents/{id}/capture { amount? }  (manual capture; partial amounts allowed)\n  POST /refunds { payment_intent_id, amount, reason }\n  GET  /payment_intents/{id}\n  POST /webhooks/psp  (PSP → us, signed)\n\nEvery state-changing POST requires an Idempotency-Key header. GETs do not. The two-step intent → confirm split lets the client run 3DS in the browser between the calls without the server holding open a long synchronous PSP socket.' },
      { section: 'Idempotency Keys', content: 'Client generates a UUIDv4 per logical action ("buy this cart now"), sends it as Idempotency-Key. Server stores (key, request_hash, response, status_code, expires_at) in an idempotency table with a unique index on key.\n\nFlow on every request:\n  1. SELECT … FOR UPDATE the row for key.\n  2. If row exists and request_hash matches → replay the stored response. Done.\n  3. If row exists and request_hash differs → 409 Conflict (the client is reusing a key for a different request — almost certainly a bug).\n  4. If no row → INSERT with status=IN_PROGRESS, then process; on completion UPDATE the row with the final response.\n\nKey TTL: 24h is typical. Long enough to survive retries during outages, short enough that storage stays bounded. The key only de-dupes the API call — the deeper authorization to the PSP is also keyed (most PSPs accept an idempotency key of their own) so a retry never reaches the card network twice.' },
      { section: 'Authorization vs Capture vs Settlement', content: 'Three distinct events that interview candidates often conflate:\n  • Authorization: ask the issuer "is this card good for $X?" Holds the funds on the cardholder side but no money has moved. Lasts 7–30 days.\n  • Capture: convert the auth into a real charge. After capture, the merchant is owed money.\n  • Settlement: the card network actually moves money from the issuer to the acquirer to the merchant\'s bank, typically T+1 or T+2.\n\nWhy separate auth and capture? E-commerce captures at ship time (you don\'t charge for what you can\'t fulfil). Hotels and car rentals pre-auth at booking, capture at checkout. Marketplaces capture only after the seller confirms. Our payment_intent has capture: automatic | manual to support both.' },
      { section: 'Double-Entry Bookkeeping', content: 'Single source of truth for money is the ledger. Schema:\n  ledger_entries(id, txn_id, account_id, direction (DR|CR), amount, currency, posted_at, metadata_jsonb)\n\nEvery business event writes two entries that sum to zero. A $50 capture posts:\n  DR  customer_clearing_account  50.00\n  CR  merchant_payable_account   50.00\n\nA refund posts the reverse. A fee posts a third pair (DR merchant_payable, CR platform_revenue). Rules:\n  1. Rows are append-only. Never UPDATE, never DELETE. Corrections are new offsetting entries.\n  2. Balance(account) = SUM(CR) - SUM(DR), computed on read or cached in a materialized view.\n  3. Every entry has txn_id so any single business event is reversible by inserting its inverse.\n\nThis makes the system audit-proof — every cent has a trail, and discrepancies between the ledger and the PSP are caught by reconciliation.' },
      { section: 'Payment State Machine', content: 'Allowed transitions (rejected transitions are logged as errors, not silently ignored):\n  REQUIRES_PAYMENT_METHOD → REQUIRES_CONFIRMATION → REQUIRES_ACTION (3DS challenge) → PROCESSING → SUCCEEDED\n  any → FAILED (terminal)\n  SUCCEEDED → DISPUTED → DISPUTE_LOST | DISPUTE_WON\n  SUCCEEDED → REFUNDED (partial refunds keep state SUCCEEDED, the refund itself has its own lifecycle)\n\nState lives in the transaction DB row, plus an immutable state_events table that records every transition with cause, actor, and timestamp. The events table is the truth — the state column on the row is a cached projection. Webhooks fire on every transition.' },
      { section: 'PSP Integration and 3DS', content: 'We never touch the PAN (Primary Account Number). Flow:\n  1. Browser collects card via PSP-hosted iframe (e.g., Stripe Elements). PSP returns a single-use payment_method_token.\n  2. Server creates payment_intent against the PSP with that token + our idempotency key.\n  3. If 3D Secure / SCA is required (mandatory under PSD2 in EU above €30), PSP returns a redirect URL. Server returns it to the client; client completes the challenge with the issuer.\n  4. PSP webhooks us back on completion with a signed payload (HMAC). Verify signature, then advance the state machine.\n\nWhy 3DS matters: when the issuer approves a 3DS-authenticated payment, liability for fraud shifts from the merchant to the issuer. For high-value transactions this is the difference between eating a chargeback and not.' },
      { section: 'Tokenization and PCI Scope Reduction', content: 'PCI-DSS classifies systems by whether they store/process/transmit cardholder data. Any system that does is "in scope" and subject to ~300 controls (annual audits, hardened networks, etc.). The goal is to keep the in-scope footprint as small as possible.\n\nStrategy: card data is captured directly by the PSP\'s JS SDK from inside an iframe served by their domain. Our backend only ever sees a token (pm_1AbCd…) which is useless outside our PSP account. Our card vault stores tokens — not PANs — so it\'s out of PCI scope for storage but still needs encryption at rest and strict access controls.\n\nFor merchants on file (subscriptions), the PSP gives us a long-lived customer_id; we keep that in our customer DB. Network tokenization (Visa Token Service) reduces churn from re-issued cards.' },
      { section: 'Fraud and Risk Scoring', content: 'Two layers:\n  1. Rules engine — fast deterministic checks: BIN country ≠ shipping country, velocity (>5 attempts/hr from one IP), AVS mismatch, CVV failure, blocklisted device fingerprint. Runs synchronously in the auth path, <30ms.\n  2. ML model — gradient-boosted tree scoring on ~200 features (account age, device history, basket value vs customer norm, time-of-day, etc.). Trained nightly on labelled chargebacks. Scored asynchronously alongside rules, used to allow/review/block.\n\nFeature store sits in Redis for online scoring + a column store (e.g., ClickHouse) for training. The model output is one number — a risk score 0–1000 — and a policy maps thresholds to actions (allow, manual_review, 3DS_step_up, decline). Tunable per merchant.' },
      { section: 'Webhooks and Async Status Updates', content: 'Most payment outcomes are asynchronous: the PSP webhook back to us, and we webhook to the merchant. Failure modes here cause most production incidents.\n\nOutbound webhooks to merchants:\n  • Sign every payload with HMAC-SHA256 using a per-merchant secret. Include a timestamp in the signature to prevent replay.\n  • At-least-once delivery. Merchant endpoint must be idempotent on event_id (we tell them in the docs).\n  • Retry policy: exponential backoff (10s, 1m, 10m, 1h, 6h, 24h), max 24h total, then route to dead-letter and surface in dashboard.\n  • All retries are visible in a per-merchant webhook log so they can replay manually.\n\nInbound webhooks from PSPs: same signing, plus a "do you really know what you sent?" check — for sensitive events (e.g., dispute opened) we call back to the PSP\'s GET endpoint with the event_id to confirm rather than trusting the body alone.' },
      { section: 'Reconciliation', content: 'PSP sends a daily settlement report (CSV or API). Job runs nightly:\n  1. Pull yesterday\'s PSP report.\n  2. SELECT all ledger entries with PSP-reference for the same day.\n  3. Match by (psp_txn_id, amount, currency). Three buckets:\n     • Matched → mark reconciled=true.\n     • In ledger but not in PSP report → likely captured today, settles tomorrow. Re-check in next run. Flag if >3 days unmatched.\n     • In PSP report but not in ledger → MISSING_INGESTION. Page on-call. This means a webhook was lost and we owe a customer a status update.\n  4. Per-currency totals must match the PSP\'s payout to our bank account to the cent. Off-by-one ⇒ investigation, not auto-resolve.\n\nReconciliation is the safety net that catches webhook loss, double-postings, and PSP-side bugs.' },
      { section: 'Refunds, Disputes, and Chargebacks', content: 'Refund (merchant-initiated): POST /refunds. Posts the inverse ledger entries, calls PSP refund API, webhooks the merchant. Full refunds can happen any time; partial refunds sum-check against the original amount in the txn row.\n\nDispute (cardholder-initiated via issuer): PSP webhook fires with dispute_opened. We freeze the merchant_payable balance by the disputed amount + dispute fee (typically $15–25). Merchant gets a deadline (usually 7–21 days) to upload evidence — order receipts, shipping proof, etc. If lost, the funds go back to the cardholder and the freeze becomes a permanent debit. If won, the freeze releases.\n\nChargeback fraud (e.g., "friendly fraud" — customer denies a real purchase) is large enough that most platforms have a dedicated dispute_evidence service to template responses for merchants.' },
      { section: 'Settlement and Merchant Payouts', content: 'Money owed to merchants accumulates in their merchant_payable_account balance. Settlement runs on a configurable schedule (T+2 default, T+0 for some markets) and pays out via:\n  • ACH (US) — cheap, 1–3 days, supports reversal.\n  • SEPA (EU) — 1 day, no reversal once accepted.\n  • Wire — expensive, same-day, irrevocable, used for large amounts.\n\nPayouts are themselves payments — they get the same idempotency, ledger entries (DR merchant_payable, CR cash), and state machine. A failed payout (closed bank account) bounces back; the funds return to merchant_payable and an alert fires.' },
      { section: 'Multi-currency and FX', content: 'Every ledger entry is denominated in a single currency. A USD merchant accepting EUR has at minimum three entries on a EUR sale:\n  DR  customer_clearing_eur     100.00 EUR\n  CR  fx_holding_eur            100.00 EUR\n  DR  fx_holding_usd            108.00 USD  (at locked rate)\n  CR  merchant_payable_usd      108.00 USD\n\nFX rate is locked at capture time and quoted by an FX provider (Wise, banks, etc.) with a small markup. The fx_holding accounts net to zero across all conversions at end-of-day. Multi-currency is where amateur ledgers fall apart — don\'t mix currencies in one entry.' },
      { section: 'Failure Modes and Recovery', content: 'Some scenarios and how the design covers them:\n  • Network drops between PSP success and our DB commit: PSP retains the txn under our idempotency key; on retry we read the same result. No double-charge.\n  • Webhook lost: nightly reconciliation surfaces it; manual replay endpoint re-posts to the merchant.\n  • PSP is down: synchronous calls fail fast (3s timeout); we mark txn FAILED_RETRYABLE and queue for a background retry with circuit-breaker per PSP. Multi-PSP routing fails over to a secondary.\n  • Ledger DB primary fails over: writes pause for ~10s. Since idempotency keys are honoured, clients retry safely.\n  • Stuck PROCESSING state: a janitor job scans for txns in PROCESSING for >24h and forces a state reconciliation against the PSP.\n\nThe ledger is the recovery anchor — as long as it is intact and append-only, everything else can be rebuilt or replayed.' },
      { section: 'Observability and Alerting', content: 'Metrics that page on-call:\n  • auth_success_rate per PSP per BIN country (a sudden drop = PSP outage or issuer blocking).\n  • webhook_retry_queue_depth (> N for X minutes = endpoint problem).\n  • reconciliation_unmatched_count (>0 for >24h).\n  • ledger_balance_drift (any non-zero net per currency at end-of-day).\n  • p99 latency on /confirm (>3s = PSP slowness).\n\nDashboards split by merchant for support. Every txn carries a correlation_id propagated to PSP calls so cross-system traces in Jaeger/Datadog can be reconstructed end-to-end. PCI scope means audit logs of every read of cardholder data; those go to an immutable WORM store separate from the application logs.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Merchant[Merchant API]
        Checkout[Checkout Page]
        MobileSDK[Mobile SDK]
    end
    subgraph Edge
        WAF[WAF and DDoS Shield]
        LB[Load Balancer]
    end
    subgraph Gateway
        APIGW[Payment API]
        Auth[Auth and API Keys]
        IdempCheck[Idempotency Middleware]
    end
    subgraph Services
        Authorize[Authorization Service]
        Capture[Capture Service]
        Refund[Refund Service]
        Dispute[Dispute and Chargeback Svc]
        Payout[Merchant Payout Service]
        Fraud[Fraud and Risk Scoring]
        Tokenize[Tokenization Service]
        StateMachine[Payment State Machine]
        WebhookSvc[Webhook Dispatcher]
        SettleSvc[Settlement Service]
    end
    subgraph Async
        Recon[Nightly Reconciliation Job]
        RetryQ[Failed Webhook Retry]
        FraudTrainer[Fraud Model Trainer]
        PayoutBatch[T+2 Payout Batcher]
        DLQ[Dead Letter Queue]
    end
    subgraph Services2 [PSPs]
        Stripe[PSP Stripe]
        Adyen[PSP Adyen]
        BankRail[ACH and Wire Rails]
    end
    subgraph Storage
        IdempDB[(Idempotency Key Store)]
        Ledger[(Double Entry Ledger Append Only)]
        TxnDB[(Transaction State DB)]
        FraudFeatures[(Fraud Feature Store)]
        VaultPCI[(Tokenized Card Vault PCI)]
        MerchantDB[(Merchant Accounts)]
        AuditLog[(Audit Trail)]
    end
    subgraph Analytics
        EventBus[Kafka Payment Events]
        Lake[(Data Lake)]
    end

    Checkout --> WAF --> LB --> APIGW
    Merchant --> APIGW
    MobileSDK --> APIGW
    APIGW --> Auth
    APIGW --> IdempCheck --> IdempDB

    APIGW -->|charge| Authorize
    Authorize --> Fraud --> FraudFeatures
    Authorize --> Tokenize --> VaultPCI
    Authorize --> Stripe
    Stripe --> Authorize
    Authorize --> StateMachine --> TxnDB
    Authorize --> Ledger
    Authorize --> Capture --> Adyen

    APIGW -->|refund| Refund --> Ledger
    Refund --> Stripe

    APIGW -->|dispute| Dispute --> Ledger
    Stripe -->|chargeback webhook| WebhookSvc --> Dispute

    SettleSvc --> BankRail
    PayoutBatch --> Payout --> BankRail
    Payout --> MerchantDB

    Stripe -->|webhook| WebhookSvc --> StateMachine
    WebhookSvc -->|fail| RetryQ --> WebhookSvc
    RetryQ -->|exceeded| DLQ

    Ledger --> Recon
    Recon --> Stripe
    Recon --> Adyen
    Recon --> AuditLog

    Authorize --> EventBus --> Lake --> FraudTrainer --> FraudFeatures

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class IdempDB,Ledger,TxnDB,FraudFeatures,VaultPCI,MerchantDB,AuditLog storage
    class Recon,RetryQ,FraudTrainer,PayoutBatch,DLQ async
    class WAF,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Synchronous PSP call vs async queue', rationale: 'Synchronous call gives the user an immediate result but ties up a thread per payment and couples our availability to the PSP. Async queue decouples throughput but requires status polling or webhooks. Most payment UIs prefer synchronous for UX up to a short timeout (~3s), then fall back to async with a "we will email you when complete" path.' },
      { decision: 'Single-row balance vs computed-from-ledger', rationale: 'A balance column updated on every write is fast to read but is a hot row and gets out of sync. Computing balance by SUM over ledger entries is the source of truth but is expensive at scale. Use a materialised view refreshed by ledger writes — fast reads with a self-healing recomputation path.' },
      { decision: 'Multi-PSP routing vs single PSP', rationale: 'Single PSP is simpler operationally but ties auth_success_rate to one provider\'s issuer relationships. Multi-PSP lets you route by BIN, country, or cost and fail over on outages, but doubles the integration surface and the reconciliation effort. Worth it past ~$100M/yr in volume.' },
      { decision: 'Capture immediately vs at fulfilment', rationale: 'Capturing at auth time gets you money sooner and avoids expired auths, but creates customer-side refund work if the order can\'t be fulfilled and inflates dispute risk on cancelled orders. Capturing at fulfilment matches money movement to the obligation. Trade-off: complexity in the auth-hold window (you might have to re-auth if the customer takes >7 days).' },
    ],
    keyTakeaways: [
      'Idempotency keys are the single most important mechanism — they protect every retry path from network drops to PSP timeouts',
      'Double-entry bookkeeping with an append-only ledger gives you a recovery anchor: as long as the ledger is intact, everything else is reconstructible',
      'Authorisation, capture, and settlement are three different events with different timings; conflating them is a common interview tell',
      'PCI scope reduction via tokenisation isn\'t optional — it saves ~80% of compliance cost and removes whole classes of breach risk',
      'Reconciliation against PSP settlement reports is the safety net that catches lost webhooks and ledger drift before customers notice',
    ],
    faqs: [
      { question: 'What is an idempotency key actually, and why must the client generate it?', answer: 'It\'s a value that uniquely identifies one logical action ("buy this cart, now"). The client must generate it because only the client knows what counts as a retry vs a new attempt. If the server generated it on first contact, the client wouldn\'t know what to send back on retry — and the request that established the key might be the one that was dropped. UUIDv4 is fine; what matters is that the same key is used for every retry of the same logical action, and a new key is used for a different action.' },
      { question: 'When exactly does the customer\'s money move, and when does the merchant get paid?', answer: 'Three distinct moments:\n  1. Authorization (real-time): issuer puts a hold on the cardholder\'s funds. Money does not move yet. Hold expires in 7–30 days.\n  2. Capture (when merchant initiates, often at ship time): the hold becomes a real charge. Cardholder sees the line item post.\n  3. Settlement (T+1 or T+2 via the card networks): money actually arrives in the merchant\'s acquiring bank account.\n\nThe merchant\'s merchant_payable balance in our ledger is credited at capture. The actual cash payout from us to the merchant\'s bank account happens on the payout schedule (often T+2 from capture) and is itself a separate ledger entry pair.' },
      { question: 'What happens if the network drops right after the PSP succeeds but before our DB commits?', answer: 'This is the canonical "lost in the middle" failure. Sequence on retry:\n  1. Client retries with the same Idempotency-Key.\n  2. Our server selects the idempotency row, finds it in IN_PROGRESS (no response stored yet).\n  3. Two options: (a) block briefly waiting for the original request to finish, or (b) reach out to the PSP\'s GET endpoint with our own idempotency key and reconcile state.\n\nOption (b) is the safer industrial pattern — the PSP\'s idempotency means asking them about our key returns the original result. We then complete our DB commit with the recovered result. The card is never charged twice; the customer either sees success or sees a clear failure with no money moved.' },
      { question: 'Why double-entry over just a balance column?', answer: 'A balance column is a single number that can be wrong forever once it\'s wrong. Double-entry forces every change to be expressed as two entries that sum to zero. Three benefits:\n  1. Auditable — anyone can recompute the balance from history.\n  2. Reversible — every business event has an inverse you can post without "fixing" the past.\n  3. Constraint-enforced — at end-of-day the sum across every account in a given currency must be zero. Any non-zero is a bug.\n\nThe ledger is also a stream of facts you can replay into other systems (analytics, regulatory reporting, customer statements) without re-deriving from application code.' },
      { question: 'What\'s the difference between a refund and a dispute? Who eats the cost?', answer: 'Refund is merchant-initiated and friendly — the merchant agrees the customer is owed money, posts an inverse ledger entry, calls the PSP refund API. The merchant loses the sale plus possibly a small per-transaction fee.\n\nDispute (chargeback) is cardholder-initiated via their issuing bank, often hostile. The PSP debits the merchant\'s balance for the disputed amount plus a dispute fee (typically $15–25). The merchant uploads evidence and either wins (debit reversed, fee usually still kept) or loses (debit permanent + fee).\n\nMerchants eat dispute costs entirely unless the transaction was 3DS-authenticated, in which case liability shifts to the issuer for fraud-related disputes (not for "merchandise not received").' },
      { question: 'How do you handle the PSP going down?', answer: 'Per-PSP circuit breakers in the auth path. Synchronous calls have a hard 3-second timeout. On open circuit:\n  • For new payments: fail fast with a retryable error, queue for background retry with exponential backoff.\n  • If you have multi-PSP routing: failover to a secondary PSP with the same idempotency_key. PSPs don\'t share idempotency state, but the second attempt is keyed on our internal txn_id so we still won\'t double-charge.\n  • For in-flight payments stuck in PROCESSING: a reconciler retries the PSP\'s GET endpoint when the circuit closes to recover state.\n\nNote: a dead PSP is fundamentally a degraded payment day — the only thing you can do is reduce blast radius (fail individual txns fast, don\'t crash the whole API) and recover state when it\'s back.' },
      { question: 'How do you reconcile when the PSP report disagrees with your ledger?', answer: 'Three patterns of disagreement and how each is resolved:\n  1. PSP shows a txn we don\'t have → we lost a webhook. Manual ingestion: load it into our ledger with the PSP\'s amount/timestamp, replay merchant webhooks, audit-log the recovery.\n  2. We show a txn the PSP doesn\'t → we marked SUCCEEDED prematurely or the PSP never confirmed. Investigate the txn\'s state_events; if no PSP success record exists, the txn should be FAILED. Post a reversal pair to the ledger.\n  3. Amounts disagree → almost always a rounding or currency conversion bug. PSP is the truth for cardholder-side amounts; correct our ledger to match.\n\nReconciliation never auto-resolves discrepancies. It pages on-call. Auto-resolving real money is how you lose customer trust.' },
      { question: 'What\'s the simplest way to support multi-currency without making the ledger a mess?', answer: 'Three rules:\n  1. Every ledger entry has a single currency. No row contains "USD or EUR".\n  2. Currency conversions are expressed as an entry pair against an fx_holding account, with the rate stored in metadata. The fx_holding account nets to zero across all conversions at end-of-day; any non-zero means you ate FX risk you didn\'t mean to.\n  3. Balances are reported per currency; the customer-facing total is computed at read time using the current rate, never stored.\n\nMost ledger bugs in multi-currency systems come from trying to be clever about "carrying" exchange rates inside transaction rows.' },
      { question: 'Why is 3D Secure worth the friction?', answer: 'Two reasons:\n  1. Liability shift — for SCA-authenticated payments, fraud-related disputes flow to the issuer, not the merchant. For high-AOV merchants this offsets the conversion hit several times over.\n  2. Compliance — PSD2 in the EU and similar rules in other markets require Strong Customer Authentication for most consumer card payments above small thresholds. Not doing 3DS means declined payments.\n\nThe trade-off is real: 3DS adds friction and ~5–10% drop in conversion. Modern flows use Risk-Based Authentication / 3DS exemptions for low-risk transactions, and step-up to a full challenge only when the risk score is high.' },
      { question: 'Is "exactly-once" really achievable?', answer: 'Not in the strict distributed-systems sense — at the network level, you can\'t distinguish "your request was lost" from "my response was lost." What you can build is "exactly-once effects" by combining at-least-once delivery with idempotency at every layer:\n  • Client → API: Idempotency-Key on the HTTP request.\n  • API → PSP: an idempotency key forwarded to the PSP.\n  • DB writes: keyed on txn_id with unique constraints.\n  • Webhook delivery: event_id, signed, deduplicated by the receiver.\n\nThe outcome from the customer\'s perspective is exactly-once: one charge, one ledger entry, one notification — no matter how many retries pass through the system.' },
    ],
  },
  {
    id: 27,
    slug: 'design-hotel-booking',
    title: 'Design a Hotel Booking System',
    difficulty: 'Medium',
    category: 'Mobile & APIs',
    tags: ['booking', 'inventory', 'concurrency', 'transactions', 'search'],
    problemStatement: `Design a hotel booking system like Booking.com. Users search for hotels by location and dates, view availability, and reserve rooms. The system must prevent double-booking (two users booking the same room on the same night).`,
    requirements: {
      functional: ['Search hotels by location, dates, guests, amenities', 'View real-time room availability', 'Reserve a room (reserve → payment → confirm)', 'Cancel booking (refund based on policy)', 'Hotel management: add/update inventory'],
      nonFunctional: ['Prevent double-booking (strong consistency for reservations)', '99.9% availability for search (can tolerate stale data)', 'Handle traffic spikes (Black Friday)', 'Search < 500ms'],
    },
    capacityEstimates: `500K hotels × avg 50 rooms = 25M room-night inventory units\nPeak: 100K booking attempts/sec during flash sales\nSearch: read-heavy, 10:1 read/write ratio`,
    solutionBreakdown: [
      { section: 'API Design', content: 'Public REST surface:\n  GET  /hotels/search?destination=&checkin=&checkout=&guests=  (returns hotels + lowest nightly rate, eventually consistent)\n  GET  /hotels/{id}/availability?checkin=&checkout=&room_type=  (real-time availability check, source-of-truth)\n  POST /bookings/hold   { hotel_id, room_type, checkin, checkout, guest_count, idempotency_key }   → returns hold_id with 10-min TTL\n  POST /bookings/{hold_id}/confirm { payment_intent_id }  → returns booking_id\n  DELETE /bookings/{booking_id}  (cancellation, subject to fare policy)\n  POST /hotels/{id}/inventory  (hotel-side: update room totals, blackout dates)\n\nHold and confirm are split intentionally — the client takes the user through payment between the two calls. Both state-changing calls take an Idempotency-Key so retries during network blips never double-book.' },
      { section: 'Inventory Data Model', content: 'The core table is one row per (hotel, room_type, night):\n  room_inventory(hotel_id, room_type, stay_date, total_count, reserved_count, held_count, version)  PK (hotel_id, room_type, stay_date)\n\nA night is the unit of inventory because that is how hotels actually sell — a 3-night stay decrements three separate rows. total_count is the hotel-set capacity; reserved_count is confirmed bookings; held_count tracks active TTL holds. Available = total_count - reserved_count - held_count. Storing per-night rows (instead of date ranges) makes the availability check a simple range query and keeps the row updates contention-localised to the actual contended nights.' },
      { section: 'Two-Phase Hold Then Confirm', content: 'The reservation flow has three states: HELD → CONFIRMED → CANCELLED (with COMMITTED-but-CANCELLED also possible).\n\n1. Hold: in a single transaction, decrement held_count for every night in the stay; insert a holds row with TTL = now() + 10 min. If any night cannot satisfy the decrement, abort and return 409 to the client.\n2. Confirm: when payment succeeds, in another transaction move the count from held_count to reserved_count and insert the booking row. The hold TTL becomes irrelevant once confirmed.\n3. Release: a janitor (or a scheduled job per hold) reverses the held_count decrement when the TTL expires without a confirm.\n\nWhy the split: it lets us commit to the user that the room is theirs before we move money, without holding a DB transaction open across an external payment call (which would burn connections and risk deadlock).' },
      { section: 'Atomic Decrement and Optimistic Concurrency', content: 'For the typical case (low contention), the hold is a single conditional UPDATE:\n  UPDATE room_inventory\n     SET held_count = held_count + 1, version = version + 1\n   WHERE hotel_id=? AND room_type=? AND stay_date=?\n     AND total_count - reserved_count - held_count >= 1\n     AND version = ?\n  -- returns affected_rows; 0 means lost the race\n\nIf affected_rows = 0, the client retries by re-reading and re-attempting (with a small jitter). This is non-blocking, lock-free, and works for ~95% of inventory rows that never see real contention. We never read-modify-write inside the application — the WHERE clause is the lock.' },
      { section: 'Pessimistic Locking for Hot Rows', content: 'A handful of rooms (e.g. a top-rated suite on New Year\'s Eve) see thousands of concurrent attempts in seconds. Pure optimistic concurrency creates a thundering herd of retries that burns CPU and rejects users essentially at random.\n\nFor known hot inventory (heuristic: >50 attempts/sec on the same row in the last minute), the booking service switches that row into "queue mode": requests are routed through a Redis-backed FIFO queue per row; one worker holds SELECT ... FOR UPDATE on the row, services queued holds in order, and releases the lock per hold. The wait is bounded (~50ms per slot) and fair. The rest of the inventory continues on the fast optimistic path.' },
      { section: 'Search Service', content: 'Search is read-heavy (10:1) and tolerates seconds of staleness — separating it from the inventory write path is what lets the system scale. Hotel metadata (name, location, amenities, photos, average price) lives in Elasticsearch, refreshed from PostgreSQL via Debezium CDC into a Kafka topic and a small consumer that updates ES documents. Geo-search uses ES geo_point with a geo_distance filter; sorting on price/rating is done with a denormalised "lowest_30d_rate" field updated by a daily job. Search results show "X rooms left at this rate" as a hint only — the booking page always re-validates against the source DB before a hold.' },
      { section: 'Dynamic Pricing and Rate Plans', content: 'Each (hotel, room_type, night) has a base rate, but the actual quote applies overlays: occupancy-based pricing (price rises as available_pct drops below thresholds), seasonal multipliers, loyalty discounts, and channel/source markups. The pricing service is a separate stateless layer that takes (hotel_id, room_type, stay_dates, guest, channel) and returns a quote_id with a TTL of ~5 minutes. The quote_id is what the client passes to /bookings/hold so the price seen on search cannot diverge from the price actually charged. Quote tokens are signed (HMAC) to prevent client tampering.' },
      { section: 'Cancellations and Refunds', content: 'Each rate has a cancellation policy stored on the booking row: refundable_until, non_refundable_fee, etc. Cancellation is a state transition from CONFIRMED to CANCELLED; in the same transaction we release the inventory (reserved_count -= 1 per night) and write a refund_request row that the payment service drains asynchronously. The inventory is freed immediately so other users can re-book — we do not wait for the refund to clear. If the refund later fails, an alert fires and the support team intervenes; we never re-take inventory we already released.' },
      { section: 'Channel Management and Overbooking', content: 'Hotels sell on multiple channels (their own site, Booking.com, Expedia, etc.). A channel manager pushes inventory deltas across channels via OTA/HTNG protocols. Two failure modes: (a) two channels confirm the last room simultaneously; (b) a channel goes silent and we sell rooms it already sold. We protect against (a) by reserving a per-channel allotment in each room_inventory row rather than a single shared count, and against (b) by surfacing stale heartbeats and freezing the affected hotel\'s public availability until reconciled. Some hotels deliberately overbook by a small percentage (typical: 5%) because of no-shows — overbooking is a hotel-level policy honoured by setting total_count slightly above physical capacity, with an oversold-handling SOP.' },
      { section: 'Storage Choices and Sharding', content: 'Inventory and bookings live in PostgreSQL — we need real ACID transactions and SELECT FOR UPDATE. Shard by hotel_id (hash, ~64 shards), because the contention boundary is the hotel: a single hotel\'s rooms are correlated, but two hotels never share inventory. Hotel metadata is read-mostly and replicated to every shard. The search layer (Elasticsearch) is sharded by geographic region. Booking history older than 13 months is moved to cold storage (S3 + Parquet) — search-by-user queries hit a small "recent" index plus an archive index on demand.' },
      { section: 'Failure Modes and Recovery', content: 'Payment succeeds but confirm fails (DB transient error): the booking service retries the confirm with the same hold_id; the confirm is idempotent on hold_id. If retries exhaust, an out-of-band reconciler matches paid payment_intents to confirmed bookings every minute and either completes the confirm or refunds the customer with a clear explanation.\n\nHold TTL expires while the user is on the payment page: the user sees a "your hold expired" message and is offered to try again — frustrating but correct. We pre-warn at T-2 minutes via a heartbeat ping from the page so the user can extend if active.\n\nHotel inventory feed goes silent: we freeze that hotel\'s availability rather than risk overselling, surface the staleness to operations, and resume only after a fresh full snapshot reconciles.' },
      { section: 'Observability and Alerting', content: 'Key metrics: hold_success_rate per hotel (a sudden drop usually means a hotel uploaded zero-inventory by mistake), hold_to_confirm_conversion (low = payment friction or pricing issue), p99 search latency, ES → PG drift (CDC consumer lag in seconds), per-row contention rate (informs the hot-row promotion heuristic). Alerts page on-call for: overbooking events (reserved_count > total_count for any row — should be zero), channel-feed heartbeat older than 5 min, refund queue growing > 100, and any inventory row stuck in held_count > 0 with no matching hold row (indicates a janitor failure).' },
    ],
    diagram: `graph TB
    subgraph Clients
        Traveler[Traveler Web]
        Mobile[Mobile App]
        HotelMgr[Hotel Manager Console]
    end
    subgraph Edge
        CDN[CDN Static Assets]
        LB[Load Balancer]
    end
    subgraph Gateway
        APIGW[API Gateway]
        Auth[Auth Service]
        RL[Rate Limiter]
    end
    subgraph Services
        SearchSvc[Search Service]
        AvailSvc[Availability Service]
        BookingSvc[Booking Service]
        HoldSvc[Two Phase Hold Service]
        ConfirmSvc[Confirmation Service]
        CancelSvc[Cancel and Refund Service]
        PaymentSvc[Payment Service]
        PricingSvc[Dynamic Pricing]
        InventoryMgr[Hotel Inventory Management]
        ReviewSvc[Reviews Service]
        NotifySvc[Email and Push Notifier]
    end
    subgraph Async
        CDCStream[Inventory CDC Debezium]
        HoldExpiry[Hold TTL Sweeper]
        Indexer[Search Indexer]
        PriceJob[Dynamic Price Updater]
        EmailQ[Confirmation Email Queue]
    end
    subgraph Storage
        InventoryDB[(Inventory DB PostgreSQL)]
        BookingDB[(Bookings DB)]
        ES[(Elasticsearch Hotel Index)]
        HoldsRedis[(Active Holds Redis TTL)]
        HotelDB[(Hotel Catalog)]
        ReviewDB[(Reviews DB)]
        PriceDB[(Rate and Price History)]
    end
    subgraph Analytics
        EventBus[Booking Events]
        Lake[(Data Lake)]
    end

    Traveler -->|search dates| CDN --> LB --> APIGW
    Mobile --> APIGW
    APIGW --> Auth
    APIGW --> RL

    APIGW --> SearchSvc --> ES
    SearchSvc --> PricingSvc --> PriceDB
    APIGW --> AvailSvc --> InventoryDB

    Traveler -->|book room| APIGW --> BookingSvc
    BookingSvc -->|optimistic lock| InventoryDB
    BookingSvc --> HoldSvc --> HoldsRedis
    BookingSvc --> PaymentSvc
    PaymentSvc --> ConfirmSvc --> BookingDB
    ConfirmSvc --> InventoryDB
    ConfirmSvc --> NotifySvc --> EmailQ

    Traveler -->|cancel| APIGW --> CancelSvc --> BookingDB
    CancelSvc --> PaymentSvc
    CancelSvc --> InventoryDB

    HotelMgr -->|add rooms or rates| APIGW --> InventoryMgr --> InventoryDB
    HotelMgr --> HotelDB

    Traveler -->|leave review| APIGW --> ReviewSvc --> ReviewDB

    HoldsRedis --> HoldExpiry --> InventoryDB
    InventoryDB --> CDCStream --> Indexer --> ES
    PriceJob --> PriceDB

    BookingSvc --> EventBus --> Lake

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class InventoryDB,BookingDB,ES,HoldsRedis,HotelDB,ReviewDB,PriceDB storage
    class CDCStream,HoldExpiry,Indexer,PriceJob,EmailQ async
    class CDN,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Optimistic vs pessimistic locking for inventory rows', rationale: 'Optimistic concurrency is lock-free and scales to thousands of QPS on uncontended rows — perfect for ~95% of inventory. Under heavy contention on hot rooms, the retry storm wastes CPU and rejects requests essentially at random; pessimistic locking with a queue gives bounded latency and fairness. Run optimistic by default, promote a row to pessimistic queue mode on detected hot-row pressure.' },
      { decision: 'Two-phase hold-then-confirm vs single-shot reserve', rationale: 'Single-shot is simpler but forces either holding a DB transaction open across an external payment call (connection burn + deadlock risk) or accepting the payment first and refunding if inventory has gone (bad UX). Two-phase isolates the slow part (payment) from the contested part (inventory) and lets us guarantee the room before charging, at the cost of a janitor for orphan holds.' },
      { decision: 'CDC-replicated Elasticsearch vs querying the DB directly for search', rationale: 'A separate ES cluster handles geo search, full-text, and complex sorts at search-page latency without competing with booking writes for DB resources. The cost is eventual consistency (a few seconds of lag) — acceptable because search just guides the user to a hotel page, where the source DB is queried again. Querying the DB directly would couple search throughput to the write-path scaling.' },
      { decision: 'Deliberate overbooking vs strict 1:1 inventory', rationale: 'Hotels routinely see 2–5% no-show rates; matching availability to physical capacity leaves rooms empty. Allowing a tunable oversell percentage increases revenue but creates the risk of "walking" a guest to another hotel (with comp). It is a business decision per hotel, not a system-wide one, and the system needs the SOP and operator dashboards to handle the rare overbook event well.' },
    ],
    keyTakeaways: [
      'Per-night inventory rows keep contention narrow — each booking only fights for the dates it actually wants',
      'Two-phase hold then confirm is the only safe way to combine slow external payments with contested in-memory inventory',
      'Optimistic concurrency for the common case plus per-row pessimistic queueing for hot rooms gives both throughput and fairness',
      'Search and inventory belong in different stores with different consistency models — eventual for search, strict for booking',
      'Pricing must be returned as a signed quote token, not just a number — otherwise the price the user clicked can silently diverge from the price they pay',
      'Releasing inventory must happen at cancellation time, never blocked on refund settlement — those are independent concerns',
    ],
    faqs: [
      { question: 'Why decrement inventory per night instead of per stay?', answer: 'Inventory is allocated per night: a 3-night booking from Friday to Sunday consumes one room on Friday, one on Saturday, and one on Sunday. Modelling each night as its own row makes the availability check a simple range query and localises contention to the actual contested nights. Storing date ranges instead forces you to do interval arithmetic on every check and cascades contention across overlapping bookings — it looks simpler but loses both performance and correctness.' },
      { question: 'How long should the hold TTL be?', answer: 'Ten minutes is the industry default and balances three things: (1) typical real users need 2–4 minutes to complete a checkout including a 3DS challenge; (2) longer holds block other buyers and depress conversion on contested inventory; (3) abandoned holds tie up rooms until the janitor releases them. We pre-warn the user at T-2 minutes and allow one one-shot extension. Hotels with very price-sensitive demand (flash sales, festival weekends) may shorten the hold to 5 minutes.' },
      { question: 'What stops a malicious client from grabbing every room in a hotel with cheap hold requests?', answer: 'Multiple layers. Per-user and per-IP rate limits on /bookings/hold in the API gateway (typical: 5 holds per minute per user). Each hold requires a valid quote token, which is itself rate-limited and tied to the user session. Repeated abandoned holds from the same account raise a fraud signal and switch that account to a "must-prepay" mode where the hold step also pre-authorises the card. Finally, the hold TTL is short enough that even a successful flood only blocks inventory for minutes.' },
      { question: 'How do you handle the inventory feed from a hotel going down?', answer: 'Each hotel\'s channel manager sends a heartbeat every 60 seconds plus full-availability snapshots every 5 minutes. If we miss two heartbeats, we mark that hotel "stale" and freeze its public availability — the hotel keeps appearing in search with a "currently unavailable" badge, but new holds are refused. The alternative — keep selling against a stale picture — leads to overbooking we have to clean up by walking guests. When the feed returns, we reconcile the snapshot against any holds taken while it was up, and resume normal operations only when the diff is clean.' },
      { question: 'How is consistency maintained between search and the booking source-of-truth?', answer: 'Search is intentionally eventually consistent. Inventory writes go to PostgreSQL; Debezium captures the row changes and emits them to a Kafka topic; an indexer consumer applies them to Elasticsearch with typical end-to-end lag of 1–3 seconds. The booking flow never trusts search — clicking a hotel triggers a fresh source-of-truth availability check, and the hold itself is the final arbiter. The CDC lag matters only for "this hotel is sold out" badging, not for double-booking.' },
      { question: 'How does this differ from a flash-sale system like Ticketmaster?', answer: 'Flash sales have a single inventory drop with predictable concentrated contention; hotel inventory is millions of independent rooms with mostly uncontested availability and rare hot spots. The flash-sale system would put every request through a queue and accept high latency; the hotel system runs optimistic on the long tail and only escalates the rare hot row to queue mode. Architecturally similar primitives (atomic decrement, idempotency, hold + confirm), but the routing and capacity planning are very different.' },
      { question: 'Why is the quote token signed?', answer: 'Pricing depends on dozens of inputs (dates, occupancy, channel, loyalty tier, applicable promotions) and can change minute to minute. If the client passed the raw price to /bookings/hold, anyone could tamper with it; if we recomputed the price server-side every time, the user could see one price on search and another on checkout. The signed quote_id is a server-issued, HMAC-protected receipt of the agreed price with a 5-minute TTL — the client cannot forge it, and we honour it for the lifetime of the quote.' },
      { question: 'What happens if payment succeeds but we fail to write the confirmed booking?', answer: 'The confirm step is idempotent on hold_id, so the booking service retries automatically. If retries exhaust within the hold TTL, an out-of-band reconciler running every minute joins paid payment_intents against confirmed bookings; for any match-without-booking it (a) retries the confirm with the still-valid payment, or (b) issues a full refund and emails the customer if the hold has since released. The customer never ends up paying for a room they did not get — but they may briefly see a "we are confirming your booking" state. The ledger and reservation tables are the recovery anchors.' },
      { question: 'Why per-channel allotments instead of one shared count?', answer: 'When the same room_inventory row is exposed to multiple OTAs (Booking.com, Expedia, the hotel\'s site), two channels can simultaneously confirm the last room before our channel manager propagates the decrement — a classic distributed-counter race. Reserving an allotment per channel (e.g. 7 rooms to Expedia, 5 to Booking.com, 3 direct) caps the worst case to a single oversell per channel and makes the failure visible per partner. The downside is some inventory may sit unsold on a quiet channel while another is sold out; channel managers re-balance allotments hourly.' },
      { question: 'What is "walking" a guest and how does the system support it?', answer: 'When a hotel oversells (deliberately or by mistake) and the last room is gone, the hotel re-houses the guest at a comparable nearby hotel and absorbs the cost difference. The system supports this via a "rebook to partner" workflow: the affected booking is moved to CANCELLED_WITH_REBOOK state, a new booking is created at the partner hotel under our account, and the price delta plus a goodwill credit is debited to the original hotel\'s ledger. The whole flow takes about a minute and is far cheaper than the brand damage of a guest stranded at midnight.' },
    ],
  },
  {
    id: 28,
    slug: 'design-flight-booking',
    title: 'Design a Flight Booking System',
    difficulty: 'Medium',
    category: 'Mobile & APIs',
    tags: ['booking', 'inventory', 'gds', 'pricing', 'distributed'],
    problemStatement: `Design a flight booking system like Expedia or airline.com. Users search for flights, compare fares, and book seats. The system must handle seat inventory across many airlines, dynamic pricing, and coordinate with airline reservation systems.`,
    requirements: {
      functional: ['Search flights by origin, destination, dates', 'Real-time fare and seat availability', 'Book seat (hold → payment → ticket issuance)', 'Itinerary management and check-in', 'Refunds per fare rules'],
      nonFunctional: ['Search < 1s for full results', 'Seat hold prevents double-booking', 'Handle 50K concurrent searches', 'Global availability'],
    },
    capacityEstimates: `50K searches/sec × avg 100 flights/search = 5M flight lookups/sec\nFlight inventory: 100K flights/day × 200 seats = 20M seat slots/day\nPricing: computed in real-time from fare rules`,
    solutionBreakdown: [
      { section: 'API Design', content: 'Public surface:\n  POST /search { origin, destination, depart_date, return_date?, pax_count, cabin } → returns offers[] with offer_id (signed, 5-min TTL)\n  POST /offers/{offer_id}/price  (re-prices the offer just before booking; many airlines require this step)\n  POST /bookings/hold { offer_id, passengers[], seat_selection?, idempotency_key } → returns PNR + hold_expires_at\n  POST /bookings/{pnr}/ticket { payment_intent_id } → returns e-ticket + receipt\n  GET  /bookings/{pnr}\n  POST /bookings/{pnr}/check-in\n  POST /bookings/{pnr}/cancel\n\nThe re-price step is a regulatory and commercial requirement on most carriers — fares move during the user\'s checkout and the airline\'s "Air Price" call is the binding quote. Without it, the ticketing step can reject the booking with a fare-changed error after we have already charged the user.' },
      { section: 'GDS and NDC Integration', content: 'Two integration models coexist:\n\nGDS (Amadeus, Sabre, Travelport): the legacy system that aggregates inventory across hundreds of airlines via the EDIFACT protocol. Cheap operationally because we integrate once, but constrained to the GDS\'s data model — bag fees, seat maps, and ancillaries are second-class citizens.\n\nNDC (New Distribution Capability, IATA standard XML/REST): direct airline integrations that expose the full merchandising surface. Higher per-airline integration cost but much better margins (airlines pay GDS distribution fees, so they offer NDC-only fares ~$10-15 cheaper).\n\nProduction systems run a router that fans out to both rails and merges results, then prefers the channel the airline marks as canonical for the fare. For ticketing we must commit on the same channel we shopped — mixing GDS shop with NDC book breaks the contract.' },
      { section: 'Fare Caching and the Lookup-to-Book Pipeline', content: 'GDS shopping calls are expensive (~$0.01-0.10 each) and rate-limited; an unattended search-form can burn six figures a day. The cache hierarchy:\n\n1. Hot route cache (Redis, TTL 5 min): keyed by (origin, destination, depart_date, return_date, cabin). Holds the last shopping response, used to fill the search-results page.\n2. Calendar cache (TTL 1 hour): lowest fare per day for the next 30 days, used for "flexible dates" widgets.\n3. Background polling: top 1000 routes refreshed proactively every minute so cache hit ratio stays >90%.\n\nThe shown fare always carries the cache age. At "book" time we re-shop the specific offer with the airline (the Air Price call) — this returns the binding fare. If it differs by more than a small tolerance, we surface a price-change confirmation before charging.' },
      { section: 'PNR Lifecycle and Seat Hold', content: 'A PNR (Passenger Name Record) is the airline-side reservation record. State machine:\n  CREATED (hold, 10-15 min TTL set by airline) → PRICED → TICKETED → BOARDED | CANCELLED | NO_SHOW\n\nThe hold step transmits passenger details and selected segments and reserves the seats. The airline returns a PNR locator (6 alphanumeric chars). Importantly, holds are not free: airlines penalise abusive hold-without-ticket behaviour and some carriers refuse holds altogether for low-fare classes (we must charge before the seat is reserved). The ticketing step is the irreversible commit: a TKT-prefixed e-ticket number is issued and the segments become flight coupons that can be flown or refunded.' },
      { section: 'Multi-segment, Multi-carrier Itineraries', content: 'A typical round-trip itinerary has 2-6 segments and may span multiple airlines (codeshares, interlining). The shopping engine constructs itineraries with a constrained search:\n  • Maximum 2 connections, minimum connection time per airport pair (45 min domestic, 90 min international).\n  • Same-PNR interline only if the carriers have an interline agreement (data from IATA).\n  • Stopover rules per fare basis.\n\nFor cross-carrier bookings, the GDS issues a single PNR with multiple ticket numbers (one per validating carrier). Pricing combinability rules (which fares can sit on one ticket) are evaluated by the GDS\'s pricing engine — we do not reimplement them.' },
      { section: 'Yield Management and Dynamic Pricing', content: 'Airlines do not set a single price per flight; they sell each flight in 8-26 booking classes (Y, B, M, H, Q, T, etc.) each with its own bucket of seats and fare rules. Yield management algorithms (EMSR-b, dynamic programming on remaining capacity vs days-to-departure) decide which classes are bookable at any moment. As lower classes sell out, the next-cheapest available fare jumps up — which is why fares "change every few minutes."\n\nOn our side we cache the visible price per booking class and re-shop on display. We never try to predict airline fare moves ourselves except for marketing widgets ("Tuesday is usually cheapest"). All real pricing is delegated to the airline.' },
      { section: 'Ticketing and the Confirm-After-Pay Race', content: 'The critical ordering: charge the card → call airline ticketing → store TKT number → email itinerary. Each step can fail.\n\nIf ticketing fails after charge succeeded, we have collected money but no ticket. Resolution:\n  1. Retry ticketing with the same idempotency key (airlines support this). Most transient failures resolve in seconds.\n  2. If the airline reports "fare no longer available," automatically re-price and re-attempt with the new price (only if delta ≤ user-consented tolerance; otherwise refund and notify).\n  3. If the airline is hard-down, queue the ticketing request and refund the customer with a clear "we will retry" message; on success, charge again (with consent) and issue the ticket.\n\nThis is the operational reality candidates often miss: the booking system is a distributed transaction across our payment, our database, and an external airline whose API we do not control.' },
      { section: 'Ancillaries: Seats, Bags, Meals', content: 'Most airline profit is in ancillaries, not base fares. The booking flow supports add-ons in two flavours:\n  • At-booking ancillaries: seat selection, checked bags, priority boarding, meals. Each is its own product with its own price and EMD (Electronic Miscellaneous Document) ticket number — separate from the flight TKT.\n  • Post-booking ancillaries: same products, sold up to 30 minutes before departure via the manage-booking flow.\n\nSeat maps are fetched from the airline at offer time (live availability) and refreshed at hold time. Seat selection itself can fail (someone else grabbed 14A) — handle gracefully with a clear "pick again" prompt rather than failing the whole booking.' },
      { section: 'Cancellation, Refund, and Schedule Change', content: 'Three flavours:\n  • Voluntary cancellation: subject to fare rules (non-refundable, partial fee, fully flexible). Engine evaluates the rule, computes the refund amount, calls the airline\'s void/refund API, then posts ledger entries.\n  • Schedule change (involuntary): airline moves a flight by >2 hours or cancels it. We get a push notification (or poll), proactively email the customer with options (accept new time, rebook, full refund), and execute the choice via the airline\'s involuntary change rail (free of charge).\n  • Same-day void: tickets can be voided within 24 hours of issuance for a full refund (US DOT rule) — fastest path because no fees apply.\n\nRefunds for IATA-issued tickets settle via BSP (Billing Settlement Plan) on a weekly batch — the customer sees the refund within 5-10 business days, but our ledger posts it immediately.' },
      { section: 'Storage and Data Model', content: 'Core tables (PostgreSQL):\n  booking(booking_id, pnr, customer_id, total_amount, currency, status, created_at, source_channel)\n  passenger(passenger_id, booking_id, name, dob, document_no, frequent_flyer)\n  segment(segment_id, booking_id, carrier, flight_no, depart_airport, depart_time, arrive_airport, fare_class, ticket_number)\n  ancillary(ancillary_id, booking_id, type, segment_id?, emd_number, amount)\n  payment_link(payment_intent_id, booking_id)\n\nSearch cache lives in Redis. The events log (state changes, airline messages) goes to Kafka for downstream consumers — fraud, loyalty, ops dashboards. Long-term flight history archived to a data lake; PII (passport numbers) encrypted with KMS-managed keys and retained per local law (often 7 years for tax, then purged).' },
      { section: 'Failure Modes', content: 'GDS is down: failover the search router to a secondary GDS (most agencies are dual-stack on Amadeus + Sabre). For ticketing, we cannot dual-stack — the offer is bound to one channel. Queue the ticketing request and surface a "we will retry" state.\n\nPNR exists but no ticket (timed out): poll the airline\'s PNR status; if hold still active, retry ticketing; if hold expired, refund the customer.\n\nAirline schedule change collides with active hold: usually surfaces as a fare invalidated on price call. Treat as a re-price event with user consent.\n\nDouble booking attempt (idempotency violation): airline rejects with "duplicate PNR" or similar. We map this back to the cached PNR locator and return the existing reservation rather than retry.' },
      { section: 'Observability and Compliance', content: 'Metrics: shop-to-book conversion per route, look-to-book ratio per GDS (cost control), airline NDC vs GDS share, ticket-success rate per airline, p99 search latency per market, abandoned-hold count.\n\nAlerts: GDS error rate spike per provider, post-charge ticket failures > 0.1%, BSP reconciliation drift, ARC/IATA reporting jobs failed.\n\nCompliance: PCI-DSS for payment, GDPR for passenger data, Secure Flight (TSA) data transmission for US flights, APIS (advance passenger info) for international segments. The system passes APIS to each operating carrier 24+ hours before departure; failure to do so means the passenger is denied boarding — a strict SLA.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Web[Traveler Web]
        Mobile[Mobile App]
        Agent[Travel Agent Tool]
    end
    subgraph Edge
        CDN[CDN]
        LB[Load Balancer]
    end
    subgraph Gateway
        APIGW[Booking API]
        Auth[Auth Service]
    end
    subgraph Services
        SearchSvc[Multi-City Search]
        FareSvc[Fare Quote Service]
        PricingEngine[Fare Rule Pricing Engine]
        YieldML[Yield Management ML]
        BookingSvc[Booking Orchestrator]
        PNRSvc[PNR Hold Service]
        Ticketing[Ticketing Service]
        PaySvc[Payment Service]
        Itinerary[Itinerary Service]
        CheckinSvc[Check-In Service]
        RefundSvc[Refund and Rebook]
        Notifier[Email and SMS Notifier]
    end
    subgraph Async
        CacheRefresh[Fare Cache Refresher]
        HoldExpiry[PNR Hold Expiry Sweeper]
        PriceTrainer[Yield Model Trainer]
        EmailQ[Email Queue]
        FailRetry[Provider Retry Queue]
    end
    subgraph Services2 [External]
        GDSAmadeus[GDS Amadeus]
        GDSSabre[GDS Sabre]
        AirlineNDC[Airline NDC API]
        AirlinePSS[Airline PSS]
    end
    subgraph Storage
        FareCache[(Fare Cache Redis 5min TTL)]
        ItineraryDB[(Itinerary DB)]
        BookingDB[(Booking DB)]
        FareRulesDB[(Fare Rules DB)]
        FlightES[(Flight Search Index)]
        PriceHistory[(Pricing Model Store)]
    end
    subgraph Analytics
        EventBus[Booking Events]
        Lake[(Data Lake)]
    end

    Web -->|search| CDN --> LB --> APIGW
    Mobile --> APIGW
    Agent --> APIGW
    APIGW --> Auth

    APIGW --> SearchSvc --> FlightES
    SearchSvc --> FareCache
    FareCache -->|miss| FareSvc
    FareSvc --> GDSAmadeus
    FareSvc --> GDSSabre
    FareSvc --> AirlineNDC
    FareSvc --> PricingEngine --> FareRulesDB
    PricingEngine --> YieldML --> PriceHistory
    FareSvc --> FareCache

    Web -->|select flight| APIGW --> BookingSvc
    BookingSvc --> PNRSvc --> AirlinePSS
    BookingSvc --> PaySvc
    PaySvc --> Ticketing --> AirlinePSS
    Ticketing --> ItineraryDB
    Ticketing --> BookingDB
    Ticketing --> Notifier --> EmailQ

    Mobile -->|check in| APIGW --> CheckinSvc --> AirlinePSS

    Web -->|cancel or rebook| APIGW --> RefundSvc --> PaySvc
    RefundSvc --> AirlinePSS

    APIGW --> Itinerary --> ItineraryDB

    CacheRefresh --> FareCache
    HoldExpiry --> AirlinePSS
    PNRSvc -.->|fail| FailRetry --> PNRSvc
    PriceTrainer --> PriceHistory

    BookingSvc --> EventBus --> Lake

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class FareCache,ItineraryDB,BookingDB,FareRulesDB,FlightES,PriceHistory storage
    class CacheRefresh,HoldExpiry,PriceTrainer,EmailQ,FailRetry async
    class CDN,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'GDS vs NDC integration', rationale: 'GDS gives broad inventory through one integration but charges distribution fees and limits us to a constrained data model. NDC delivers richer airline merchandising (better fares, ancillaries) but requires per-airline integration. Mature platforms run both rails and route by fare/availability; the operational cost of NDC integrations is justified above roughly $50M GMV per partner.' },
      { decision: 'Cache aggressively vs always re-shop at offer time', rationale: 'Aggressive caching makes search instant and keeps GDS costs sane, but the price the user sees can be stale by minutes. Always-re-shopping is technically perfect but punishes conversion (slow search) and bankrupts you on look-to-book ratios. The pragmatic answer is cached display + a binding re-price call at the booking step.' },
      { decision: 'Charge before ticketing vs hold seat then charge', rationale: 'Charging first means a guaranteed-funded ticket, but creates the post-charge-pre-ticket refund risk if the airline rejects. Seat-hold-then-charge avoids that risk but requires the airline to honour the hold and exposes us to abandoned-hold abuse. Most flows charge first because the failure rate is <0.1% and the operational cost of refunds is lower than the cost of held inventory.' },
      { decision: 'Same-PNR multi-carrier vs separate PNRs (self-transfer)', rationale: 'Same-PNR interlining gives the customer protection if the first segment delays them off the second segment — the carriers must rebook for free. Separate PNRs ("self-transfer") unlocks cheaper combinations but the customer bears all the risk of a missed connection. Some agencies sell self-transfer with a guarantee insurance product; communicating which model is in play is critical to avoid support disasters.' },
    ],
    keyTakeaways: [
      'The airline owns inventory and pricing — we are a thin shopping and orchestration layer over the GDS/NDC integration',
      'Cache the display, but re-price every booking with the airline before charging — fares move and the binding quote is the airline\'s, not ours',
      'Ticketing after payment is the highest-stakes operation in the system; design for the post-charge-pre-ticket failure with idempotency and a recovery queue',
      'Ancillaries and yield management are where the profit lives — surface seats, bags, and class upgrades as first-class products',
      'Treat APIS, Secure Flight, and BSP reconciliation as production SLAs, not back-office tasks — a missed APIS submission denies boarding',
      'Same-PNR interlining vs self-transfer is a customer-protection decision, not just a fare optimisation — be explicit with the customer',
    ],
    faqs: [
      { question: 'What is a PNR exactly and why does it matter?', answer: 'A PNR (Passenger Name Record) is the airline-side reservation record — a six-character locator (e.g. ABC123) plus the passenger, segment, and contact data. It is the only identifier the airline\'s downstream systems (check-in, boarding, irregular operations) recognise. Our internal booking_id is for our own bookkeeping; everything that touches the customer at the airport keys off the PNR. If we lose the PNR mapping, the customer cannot check in even though they paid. Storing the PNR durably and binding it to a payment is the first job of the booking service.' },
      { question: 'Why does the price sometimes change between search and booking?', answer: 'Airlines sell each flight in many fare classes (Y, B, M, H, Q, T…), each with its own seat allotment. As lower classes sell out, the next-cheapest available fare jumps up — sometimes within seconds. Our cached display can be 1-5 minutes stale; the binding number is whatever the airline\'s Air Price call returns at booking. We surface meaningful price changes back to the user before charging, with a clear "the fare has changed to X — accept or cancel?" prompt. We never silently book at a higher price.' },
      { question: 'What happens if we charge the card but ticketing fails?', answer: 'This is the classic post-charge race. The booking service retries the ticketing call with the same idempotency key; airlines support this and resolve most transient failures within a few seconds. If the airline reports "fare no longer available", we automatically re-price; if the new price is within the user\'s consented tolerance (set at checkout), we proceed; otherwise we refund and surface options. For hard airline outages, we queue the ticketing request, refund immediately with a clear message, and re-issue when the airline returns (with fresh user consent). The customer\'s money never sits in limbo without an explanation.' },
      { question: 'How do you handle a flight schedule change initiated by the airline?', answer: 'Airlines push schedule changes (involuntary changes, IRROPS) via Type B messages or NDC notifications. The system ingests them, evaluates impact (departure shift > 2 hours, segment cancelled, missed connection), and triggers a notification flow: email the customer with the options the airline rules permit — accept the new time, rebook on a same-day alternative, full refund. The customer\'s choice is executed via the airline\'s involuntary-change rail, which waives fees. Critical detail: a schedule change can invalidate seat assignments and ancillaries; we surface those side effects in the notification.' },
      { question: 'Why not just run our own seat inventory?', answer: 'Two reasons. (1) We do not own the seats — the airline does. Even codeshare partners do not have authoritative inventory for the operating carrier. (2) Airline revenue-management algorithms re-tune availability per fare class continuously based on bookings across every distribution channel; replicating that signal is impossible without being the airline. We integrate against the airline\'s authoritative inventory via GDS or NDC and accept that some lookups will return "no longer available" — that is the cost of the model.' },
      { question: 'What is BSP and why should you care?', answer: 'BSP (Billing Settlement Plan) is the IATA-run financial clearing house for airline tickets. When we issue a ticket through a GDS, the money flows: customer → us → BSP → airline (less commission). Settlement is weekly, with strict reporting deadlines (we report Tuesday for the prior week, money moves Wednesday). A missed BSP report can suspend our IATA agency licence — the operational risk is existential. Refunds also flow through BSP. NDC bookings often bypass BSP (direct merchant model) and settle via the airline\'s own merchant of record.' },
      { question: 'How is this different from hotel booking?', answer: 'Hotel inventory is local (we control the row in our DB) and contention is mostly low. Flight inventory is owned by the airline — we never see the raw seat count, only the response to a shop call. Hotel pricing rules are simple compared to airline fare rules (combinability, branded fares, codeshares, interline). Hotels rarely fail at booking; airlines fail regularly (fare-changed, seat-gone, system-down) and the booking service has to be robust to all of them. The two systems share the API shape (hold → confirm) but the failure surface is much larger for flights.' },
      { question: 'What about same-day-of-travel changes and check-in?', answer: 'Check-in opens 24-48 hours before departure depending on carrier. We expose check-in via our app by deep-linking into the airline\'s check-in flow with the PNR pre-filled (most carriers support a partner check-in API); some markets require us to render check-in ourselves with full APIS data collection. Same-day changes go via the airline\'s irregular-ops or voluntary-same-day-change product. Day-of cancellations after check-in are denied by most carriers — we surface that constraint clearly on the manage-booking page.' },
      { question: 'How do you prevent the search API from being a $100K/day cost centre?', answer: 'Search cost is dominated by look-to-book ratio (number of shopping calls per actual booking). Multiple defences: (1) rate-limit anonymous search aggressively, require login for repeat searches; (2) maintain a hot-route cache with 90%+ hit ratio so most searches never touch GDS; (3) bot detection — Akamai or Cloudflare bot management blocks the worst scrapers; (4) cost dashboards per route and per GDS so unusual spikes alert; (5) negotiated GDS contracts with tiered pricing — the marginal cost of a search should fall below $0.005 at scale. Above ~500:1 look-to-book we are bleeding.' },
      { question: 'What is APIS and why is it a hard SLA?', answer: 'APIS (Advance Passenger Information System) is the data feed governments require for inbound flights — passport number, date of birth, nationality, etc. The transmission must happen 24-72 hours before departure to the operating carrier, who forwards it to the destination country\'s border authority. If APIS data is missing or invalid, the airline denies boarding at the gate. Our system collects this data at booking (or via a "complete your check-in" reminder), validates against passport regex, and ships it via the airline\'s SSR (Special Service Request) channel before the cutoff. Failure here strands customers at the airport — it is a P0 SLA, not a back-office data task.' },
    ],
  },
  {
    id: 29,
    slug: 'design-stock-trading-platform',
    title: 'Design a Stock Trading Platform',
    difficulty: 'Hard',
    category: 'Real-time Systems',
    tags: ['trading', 'order-book', 'matching-engine', 'low-latency', 'financial'],
    problemStatement: `Design a stock trading platform where traders place buy/sell orders, which are matched by a central order book. Market prices update in real time. Regulatory requirements demand an immutable audit trail of all orders and trades.`,
    requirements: {
      functional: ['Place market and limit orders (buy/sell)', 'Order matching engine (price-time priority)', 'Real-time market data feed (prices, order book depth)', 'Portfolio tracking', 'Order history and trade confirmations'],
      nonFunctional: ['< 1ms order processing latency', 'Strict ordering of events', '99.999% availability', 'Immutable audit log for regulatory compliance'],
    },
    capacityEstimates: `NYSE: ~1B orders/day ≈ 11,500 orders/sec average\nPeak: 10× ≈ 115,000 orders/sec\nMarket data: ~1M price updates/sec across all symbols`,
    solutionBreakdown: [
      { section: 'Order Entry API', content: 'External venues expose FIX (Financial Information eXchange) over TCP for institutional flow and a binary protocol (e.g. ITCH-style or proprietary) for co-located low-latency clients. Internal REST/WebSocket APIs serve retail brokers.\n\nKey messages:\n  NewOrderSingle (FIX 35=D): { client_order_id, symbol, side (BUY/SELL), order_type, qty, price?, tif (DAY/IOC/FOK/GTC) }\n  OrderCancelRequest (35=F): { client_order_id, orig_client_order_id }\n  OrderCancelReplaceRequest (35=G): cancel + new in one message\n  ExecutionReport (35=8): server → client, sent on ACK, partial fill, full fill, cancel, reject\n\nclient_order_id is the trader-generated idempotency key — duplicate IDs are rejected at the gateway, never reach the book. Every message carries a sequence number; gaps trigger session resync per FIX semantics.' },
      { section: 'Order Book Data Structure', content: 'The order book per symbol is two price-ordered structures:\n  bids: descending price → FIFO queue of resting orders at that price\n  asks: ascending price → FIFO queue of resting orders at that price\n\nProduction implementations use a price-level array (one slot per tick from min to max plausible price) for O(1) best-bid/best-ask lookup, with each slot owning a doubly-linked list of orders for O(1) insert/remove. Total memory: 100K ticks × 64B header = 6.4MB per symbol; even 8000 US-listed equities fit comfortably in RAM. The "top of book" (best bid, best ask, sizes) is a struct cached on a hot cache line for the hottest path.' },
      { section: 'Matching Algorithm', content: 'Price-time priority (also called FIFO). On a marketable incoming order:\n  while incoming.qty > 0 and best_opposite_side_price crosses incoming:\n    resting = head_of_queue at best_opposite_side_price\n    fill_qty = min(incoming.qty, resting.qty)\n    emit trade(price = resting.price, qty = fill_qty, buy_order, sell_order)\n    decrement both quantities\n    if resting.qty == 0: pop\n  if incoming.qty > 0: insert at tail of incoming.price queue (or cancel if IOC/FOK)\n\nThe trade prints at the resting order\'s price (price improvement for the aggressor). Pro-rata and size-priority schedules exist in some derivatives markets but FIFO is the universal default for equities. Every match generates one trade event and zero, one, or two cancel-of-remainder events.' },
      { section: 'Single-threaded Engine per Symbol', content: 'Each symbol\'s matching engine is a single-threaded event loop pinned to one CPU core. Why:\n  • Determinism: same input sequence → same outputs, byte-for-byte. Critical for replay-based recovery and regulatory reconciliation.\n  • No locks: every operation is a serial mutation of the in-memory book; no atomics, no contention.\n  • Cache locality: book lives entirely in L2/L3 of the pinned core.\n\nThroughput per core: 1-2 million orders/sec for a well-optimised engine (NASDAQ\'s INET matched ~10M msg/s at peak). Symbols are sharded across cores; cross-symbol concerns (basket orders, portfolio risk) are handled in a separate orchestration layer that fans out symbol-level orders.' },
      { section: 'Sequencer and Determinism', content: 'Before any matching, a sequencer process serialises all order events into a strict global order and assigns a monotonic sequence number. The sequencer is itself single-threaded and is the single source of truth for "what happened in what order." Downstream consumers (matching engines, market data, audit log) replay the sequenced stream.\n\nThis is the architectural pattern from LMAX Disruptor: lock-free ring buffers, sequencer claims slots atomically, consumers pin to cores. The whole pipeline runs in user-space, busy-waiting for new events to avoid context-switch jitter.' },
      { section: 'Order Types and Time-in-Force', content: 'Beyond market and limit:\n  IOC (Immediate-Or-Cancel): match what you can immediately, cancel the rest. Used for "take liquidity now" routing.\n  FOK (Fill-Or-Kill): all-or-nothing — if not fully fillable at entry, cancel entirely. Common for large block trades.\n  GTC (Good-Til-Cancelled): rests until filled or cancelled, persisted across sessions.\n  GTD (Good-Til-Date): expires at a specific time.\n  Stop / Stop-Limit: dormant until trigger price crosses; then becomes a market or limit order. Stored in a separate trigger book keyed by price; market-data ticks scan it on every print.\n  Iceberg: large order displays only a small visible "tip"; replenishes from a hidden reserve after each fill. Implemented as a single order in the book with a visible_qty field.\n\nMiddle-of-the-book special order types (pegged, MOO/MOC, midpoint peg) are an exchange policy concern and live in the engine\'s order-type dispatcher.' },
      { section: 'Risk Controls and the Pre-Trade Path', content: 'Every order passes through a risk gate before the sequencer. Checks (SEC Rule 15c3-5 mandates these in microseconds):\n  • Buying power: notional value of order ≤ available cash + margin.\n  • Position limits: post-trade position would not exceed firm or trader limit.\n  • Order size cap: protects against fat-finger (e.g. no single order > $10M).\n  • Price collar: limit price within ±10% of last trade (rejects mis-keyed prices).\n  • Self-trade prevention: cancel newer side if the trader\'s own resting order would cross.\n  • Restricted-list check: symbol not on the firm\'s no-trade list.\n  • Duplicate detection: client_order_id not seen in last 24h.\n\nRisk state is a per-account in-memory struct kept hot; updates flow from fills back into buying power on every execution report. Risk is the slowest synchronous step — budget ≤50μs in HFT systems.' },
      { section: 'Market Data Distribution', content: 'Three feed tiers:\n  Level 1 (TBBO): top-of-book best bid/ask + last trade. Cheap, used for retail apps.\n  Level 2: full depth-of-book up to N levels per side. Used by professional traders.\n  Level 3 (ITCH-like): every order add/cancel/modify event. Used by HFTs to reconstruct the book themselves.\n\nThe engine emits binary updates over UDP multicast for co-located clients (microsecond delivery); the same stream is also pushed to Kafka for downstream apps and replay. Sequence numbers let consumers detect drops and request gap-fill via a TCP recovery channel. Critically: market data must be deterministic relative to the matched trades — same sequence, same view.' },
      { section: 'Persistence and Replay', content: 'The book is in-memory. The recovery anchor is the sequenced event log written to disk before the matching engine processes any event. On crash:\n  1. Start engine with an empty book.\n  2. Replay the event log from the last snapshot (taken every minute) up to the current sequence.\n  3. Resume consuming from the sequencer.\n\nWrite path: the sequencer writes each event to a memory-mapped log file with O_DIRECT and forces an fsync every N events or every 100μs. Recovery time for a single symbol: seconds. The cluster runs primary-secondary with synchronous log replication; a failover takes <10s during which orders are rejected with a "try again" code rather than silently dropped.' },
      { section: 'Clearing and Settlement', content: 'A trade match is only the start. Post-trade:\n  • Clearing: trades sent to a Central Counterparty (CCP — e.g. NSCC for US equities). The CCP novates each trade — becomes the counterparty to both sides — and nets exposures.\n  • Settlement: T+1 in the US (since May 2024) — securities and cash exchange one business day after trade. Failed deliveries trigger fails-to-deliver reporting.\n  • Books and records: each trade posts to a double-entry ledger (cash account vs securities account) per customer.\n\nThe matching engine does not do clearing — it hands off trade reports to a clearing service that bridges to DTCC/NSCC via a separate batch interface (CTM/Omgeo). This is also where regulatory reporting (CAT, OATS replacement) is generated.' },
      { section: 'Audit Trail and Regulation', content: 'CAT (Consolidated Audit Trail) requires every order event tagged with a CAT order ID and reportable to FINRA by 8am the next day. Every cancel, modify, route, and fill must be linkable to the originating order across all venues.\n\nImplementation: the sequenced event log is the canonical source. A nightly job extracts and formats events into CAT submission files (XML), signs them, and uploads. Reconciliation runs against the firm\'s books to ensure no event was lost. Late or wrong submissions = multi-million-dollar fines.\n\nThe log is immutable and tamper-evident (Merkle-chained or written to WORM storage). Retention: 7 years minimum. This is the recovery anchor for the entire system — without it, neither operations nor compliance can stand up.' },
      { section: 'Observability and Circuit Breakers', content: 'SLIs:\n  • End-to-end latency from order receipt to ack (P50 / P99 / max) — tail latency matters more than average.\n  • Matching engine queue depth.\n  • Risk gate reject rate and reasons.\n  • Market data sequence gap count.\n  • Book imbalance per symbol.\n\nMarket-wide circuit breakers (Reg SHO equivalents) auto-halt a symbol if the price moves more than X% in Y seconds — protects against flash-crash spirals. Per-firm kill switches let risk officers freeze all order entry from one trader or strategy in one keystroke. Both must engage in <1 second from trigger.\n\nClock sync: all servers slaved to a PTP grandmaster (sub-microsecond accuracy) — required for accurate sequencing and for regulators (CAT mandates 50ms timestamp accuracy, often tightened to 100μs in practice).' },
    ],
    diagram: `graph TB
    subgraph Clients
        RetailTrader[Retail Trader]
        Algo[Algo Trader]
        FIXClient[FIX Institutional Client]
        Display[Price Display Subscriber]
    end
    subgraph Edge
        ColocGW[Colo Order Gateway FPGA]
        WSGW[WebSocket Market Data Gateway]
    end
    subgraph Gateway
        APIGW[Order API]
        Auth[Auth and Entitlements]
    end
    subgraph Services
        RiskEngine[Pre Trade Risk Engine]
        OrderRouter[Order Router]
        MatchAAPL[Matching Engine AAPL]
        MatchTSLA[Matching Engine TSLA]
        MatchOther[Matching Engines Other Symbols]
        OrderBook[In Memory Order Book]
        Portfolio[Portfolio and Position Service]
        ClearSvc[Clearing and Settlement]
        Compliance[Compliance and Surveillance]
        MarketDataSvc[Market Data Distribution]
    end
    subgraph Async
        AuditStream[Audit Sequencer Kafka]
        MDStream[Market Data Feed Kafka]
        Reconcile[End of Day Reconcile]
        ColdArchive[Cold Storage Archiver]
        SurveillanceJob[Surveillance Replay]
    end
    subgraph Storage
        AuditLog[(Append Only Audit Log)]
        PortfolioDB[(Portfolio DB)]
        SettleDB[(Settlement DB)]
        RefData[(Symbol Reference Data)]
        UserDB[(User Accounts)]
        ColdS3[(Cold Archive S3)]
    end
    subgraph Analytics
        TickStore[(Tick Data Warehouse)]
        Dash[Trading Dashboards]
    end

    RetailTrader -->|order| APIGW --> Auth
    Algo -->|order| ColocGW
    FIXClient -->|FIX 4.4| ColocGW
    APIGW --> OrderRouter
    ColocGW --> OrderRouter
    OrderRouter --> RiskEngine --> UserDB
    RiskEngine --> RefData

    RiskEngine -->|approved AAPL| MatchAAPL --> OrderBook
    RiskEngine -->|approved TSLA| MatchTSLA --> OrderBook
    RiskEngine -->|approved other| MatchOther --> OrderBook

    MatchAAPL --> AuditStream --> AuditLog
    MatchTSLA --> AuditStream
    MatchAAPL --> MDStream --> MarketDataSvc --> WSGW --> Display
    MarketDataSvc --> Algo

    MatchAAPL -->|fills| Portfolio --> PortfolioDB
    Portfolio --> ClearSvc --> SettleDB

    AuditLog --> Compliance --> SurveillanceJob
    AuditLog --> ColdArchive --> ColdS3
    SettleDB --> Reconcile

    MDStream --> TickStore --> Dash

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class AuditLog,PortfolioDB,SettleDB,RefData,UserDB,ColdS3 storage
    class AuditStream,MDStream,Reconcile,ColdArchive,SurveillanceJob async
    class ColocGW,WSGW edge
    class TickStore,Dash analytics`,
    tradeoffs: [
      { decision: 'Single-threaded matching engine vs multi-threaded', rationale: 'Single-threaded eliminates lock contention and gives deterministic replay — critical for crash recovery and regulatory reconciliation. A multi-threaded engine would need transactional memory or fine-grained locking, both of which destroy P99 latency and reproducibility. The cost is a hard symbol-level throughput ceiling (~1-2M orders/sec per core); we live with this and shard symbols across cores.' },
      { decision: 'In-memory book with replay log vs durable database backing every operation', rationale: 'A traditional ACID DB cannot match the latency budget — disk fsyncs are milliseconds, matching budget is microseconds. The in-memory book with an append-only event log is the only design that meets latency targets; recovery is via replay from the log, which takes seconds. The trade-off is operational complexity — the team needs to operate a stateful event-sourced system, not just a CRUD backend.' },
      { decision: 'Co-located UDP multicast market data vs polling REST', rationale: 'UDP multicast delivers updates in microseconds to thousands of subscribers from a single send — required for any HFT use case. REST polling is simpler and works for retail dashboards but adds 10-100ms of latency and breaks the deterministic-stream property. Most exchanges run both: multicast for pros, a delayed REST feed for retail and consumer apps.' },
      { decision: 'Reject on full risk failure vs throttle', rationale: 'Hard reject (the SEC 15c3-5 standard) is simpler and bounds blast radius — a runaway algorithm cannot push past its limits. Throttling sounds friendlier but obscures real problems and creates queueing pathologies under stress. The correct pattern is hard reject + a clear error code, and surface the limit explicitly so traders know when they are approaching it.' },
      { decision: 'Sequence-then-match vs match-then-sequence', rationale: 'Sequencing before the matching engine guarantees that every consumer (matchers, market data, audit) sees the same event order. Doing it after the matcher means multiple matchers running in parallel would need post-hoc reconciliation. Sequence-first is the LMAX/Disruptor pattern and the industry default; the central sequencer becomes a single point of failure that requires active-passive redundancy with sub-second failover.' },
    ],
    keyTakeaways: [
      'A single-threaded matching engine per symbol with a global sequencer is the standard architecture — determinism is non-negotiable',
      'The sequenced event log is the recovery anchor: lose it and you lose books, records, and your regulatory licence',
      'Pre-trade risk in microseconds (SEC 15c3-5) is mandatory and is the highest-latency synchronous step in the pipeline',
      'Price-time priority (FIFO) is the universal matching rule for equities; iceberg, IOC, FOK, and stop orders are variants layered on top',
      'Market data must be deterministic relative to trades; consumers detect drops via sequence gaps and recover via a TCP gap-fill channel',
      'Clearing and CAT reporting are post-trade workloads that depend entirely on the event log — design them in from day one, not bolted on',
    ],
    faqs: [
      { question: 'Why a single-threaded engine when modern servers have 64+ cores?', answer: 'Because the order book is the contended structure. Any multi-threaded design needs either coarse locks (which serialises anyway, with extra overhead) or fine-grained locks/atomics (which destroy cache-line locality and P99 latency). A single thread pinned to a core with the book in L2/L3 runs 1-2M ops/sec deterministically. We use the other cores for other symbols, risk, market data fan-out, and audit log writers — all parallel, but the matching of one symbol stays single-threaded. This is the LMAX Disruptor lesson restated for exchanges.' },
      { question: 'How is price-time priority actually implemented in O(1)?', answer: 'A price-level array indexed by ticks: bids[tick] and asks[tick] each point to a doubly-linked list of orders at that price level. Best bid is bids[highest_active]; best ask is asks[lowest_active]. Inserts go to the tail of the list at the order\'s price (preserving time priority). Cancels go through an order_id → list_node hashmap for O(1) removal. The "active" extremes are maintained as a bitmap or active-level cache so we never scan the array. Matching pops from the head of the opposite side\'s best level until the incoming order is filled or rests.' },
      { question: 'What is the actual latency budget?', answer: 'For a co-located client: order wire-on to ack wire-off, P99 below 50 microseconds is competitive; below 10 microseconds is HFT-grade. Breakdown: network ingress 1-2μs, parse + risk 5-15μs, sequencer 1-3μs, match + audit emit 2-5μs, market data fan-out 3-5μs, ack out 1-2μs. Anything that touches the kernel or allocates memory is too slow — engines use kernel-bypass NICs (Solarflare/Onload), pinned cores, busy-polling, and pre-allocated object pools. Garbage-collected runtimes (vanilla Java) cannot hit this; teams use Java with off-heap memory + tuned GC, or C++ / Rust.' },
      { question: 'How do you guarantee fairness when two orders arrive "at the same time"?', answer: 'There is no "same time" inside the engine — the sequencer assigns a monotonically increasing sequence number to every event, and that defines order. The fairness question becomes: how does the sequencer arbitrate concurrent network arrivals? Exchanges use deterministic tie-breakers — usually round-robin across input queues, or arrival timestamp at the network card (PTP-synchronised). Some exchanges introduce a small randomised delay ("speed bump", like IEX\'s 350μs) to defeat micro-latency advantages. The chosen policy is publicly documented because traders price their strategies against it.' },
      { question: 'What happens when the matching engine crashes mid-trade?', answer: 'The event log is written before the matcher acts, so any partially processed event will be re-played on restart. The matcher reconstructs the book by replaying from the last snapshot (taken every 60 seconds) plus the tail of the log. Recovery time for one symbol: typically 2-10 seconds. During recovery the order gateway returns "service unavailable" for that symbol so clients can retry. Hot standby: a secondary engine consumes the same event stream live and is ready to take over with sub-second cutover. The invariant we never violate: a trade was either reported and durable, or it never happened — no half-committed state.' },
      { question: 'How does the system stop a runaway algorithm?', answer: 'Multiple layers. Pre-trade: the risk gate hard-rejects orders that exceed firm-level or trader-level limits, in microseconds — required by SEC 15c3-5. In-flight: kill switches let a risk officer freeze all order entry from one strategy, account, or whole firm in one keystroke (sub-second propagation). Reactive: per-symbol Limit Up / Limit Down (LULD) bands halt trading if the price moves more than X% in 5 seconds — the matching engine refuses crossing prints and the market enters a "limit state". Market-wide circuit breakers halt the entire market on a 7% / 13% / 20% intraday drop. Each layer assumes the previous one might fail.' },
      { question: 'Why must market data be deterministic?', answer: 'Because every market participant — algos, brokers, the SEC — reconstructs the book from the feed. If two consumers receive the same updates in different orders, they will disagree on what the book looked like at a given microsecond, and that disagreement contaminates everything downstream (audit, risk, customer dispute resolution). The deterministic event stream is what makes the post-trade ecosystem possible. We achieve this by emitting market data from inside the matching engine after each event, in the same sequence as the trades themselves, and by using sequence numbers consumers can verify and gap-fill.' },
      { question: 'What is a "self-trade" and how do you prevent it?', answer: 'A self-trade is when the same beneficial owner sits on both sides of a trade — usually two strategies in the same account crossing each other. It is potentially illegal (wash trading suspicion) and certainly bad for the firm (commission paid to themselves, regulatory scrutiny). Self-trade prevention runs in the matching engine: when an incoming order would match against the same account\'s resting order, the engine either cancels the newer side, cancels the older side, or decrements both — configurable per account. The check is a single comparison per match, costs nanoseconds, and is required by most exchanges.' },
      { question: 'How is this different from a high-throughput order system like e-commerce?', answer: 'E-commerce can tolerate millisecond-to-second latency and eventual consistency on most operations; trading cannot. E-commerce databases handle the throughput because writes are spread across millions of independent rows; trading concentrates ALL orders for a symbol onto one core because of price-time priority. E-commerce treats outages with retry-and-eventually-consistent; trading treats them with reject-fast-and-replay-from-log. The architectural primitives (idempotency, event sourcing) overlap, but the latency and determinism budgets are categorically different.' },
      { question: 'What does the audit log actually need to contain?', answer: 'Every event that changes engine state: order received (with full message body), risk decision, sequence assignment, match, partial fill, cancel, modify, expiry. Each entry has a sequence number, hardware timestamp (PTP-synchronised, sub-microsecond), and a hash chained to the previous entry. CAT regulations require linkable order lifecycle reporting — from receipt through every route and modify to final disposition. The log is the truth: books and records, customer dispute resolution, and regulator inquiries all derive from it. Retention is 7 years on WORM storage. Lose the log, lose the firm.' },
    ],
  },
  {
    id: 30,
    slug: 'design-gaming-leaderboard',
    title: 'Design a Gaming Leaderboard',
    difficulty: 'Medium',
    category: 'Distributed Systems',
    tags: ['leaderboard', 'redis', 'sorted-set', 'real-time', 'ranking'],
    problemStatement: `Design a real-time gaming leaderboard that shows the top players by score. The leaderboard must update instantly when scores change, support global and friend-based leaderboards, and show a player's rank among millions of players.`,
    requirements: {
      functional: ['Update player score', 'Get top N players (global leaderboard)', 'Get player\'s rank and score', 'Get players around a specific rank (neighborhood)', 'Friend leaderboard (rank among friends)'],
      nonFunctional: ['Score update < 10ms', 'Rank query < 50ms', 'Support 100M players', 'Real-time updates visible within 1s'],
    },
    capacityEstimates: `100M players in sorted set\nRedis ZADD: O(log N) ≈ log(100M) ≈ 27 operations\nZSCORE / ZRANK: O(log N)\nMemory: 100M entries × 64B = 6.4GB — fits in Redis`,
    solutionBreakdown: [
      { section: 'API Design', content: 'Public endpoints:\n  POST /scores { player_id, game_id, score, occurred_at, idempotency_key } → 204\n  GET  /leaderboards/{game_id}/top?limit=10 → [{ rank, player_id, score, display_name, avatar }]\n  GET  /leaderboards/{game_id}/players/{player_id} → { rank, score, percentile }\n  GET  /leaderboards/{game_id}/around/{player_id}?window=5 → 11 neighbours\n  GET  /leaderboards/{game_id}/friends/{player_id}?friend_ids=… → friends ranked among each other\n  GET  /leaderboards/{game_id}?period=daily|weekly|allTime\n\nScore writes accept an idempotency_key so duplicate match-end webhooks from the game server do not double-count. Read endpoints are cacheable per (leaderboard, page) for 1-2 seconds with a stampede-protected refresh.' },
      { section: 'Redis Sorted Set Mechanics', content: 'Redis ZSET stores (member, score) pairs in two structures: a hash table for O(1) score lookup by member, and a skip list ordered by (score asc, member asc lexically) for O(log N) rank operations. Operations and complexities:\n  ZADD leaderboard:game42 4500 player:99   — O(log N)\n  ZINCRBY leaderboard:game42 50 player:99  — O(log N), atomic increment\n  ZSCORE leaderboard:game42 player:99      — O(1)\n  ZREVRANK leaderboard:game42 player:99    — O(log N)\n  ZREVRANGE leaderboard:game42 0 9 WITHSCORES — O(log N + K)\n\n100M entries × ~64 bytes = ~6.4 GB per leaderboard, comfortably fits a single Redis primary with replicas. The 64B figure assumes ziplist encoding is no longer in use (size > 128) so we are in skiplist + hash territory.' },
      { section: 'Score Update Pipeline', content: 'On a game event the game server publishes a Kafka message; a scorer consumer batches updates and pipelines them into Redis:\n  MULTI\n  ZADD leaderboard:game:42 GT 4500 player:99  -- GT only updates if new score greater\n  ZADD leaderboard:game:42:daily:20260614 GT 4500 player:99\n  ZADD leaderboard:game:42:weekly:2026-W24 GT 4500 player:99\n  EXEC\n\nThe GT flag prevents an out-of-order older message from rolling back a higher score. For cumulative scores (XP), use ZINCRBY instead. Pipelining 100 updates per round-trip gives us >500K updates/sec from a single consumer; with 8 partitions and 8 consumers we exceed 4M updates/sec — far above projected peak.' },
      { section: 'Tie-Breaking and Sub-Score Ordering', content: 'Pure score-based ordering creates massive ties at common scores. Two strategies:\n\n1. Lexicographic member trick: Redis already orders ties by member (lexically). Composing the member as zero-padded timestamp + player_id breaks ties by who scored first.\n\n2. Composite score: encode multiple fields into one double. Example: combined_score = score × 1e10 + (1e10 - earlier_timestamp_ms). Reaching a score first wins ties. Beware the IEEE-754 precision ceiling — doubles give 15-17 significant decimal digits, so cap the total range.\n\nMost games use option 2 for "earliest to reach this score" semantics; option 1 is simpler when you only need stable order.' },
      { section: 'Neighbourhood and Pagination Queries', content: 'Show "you are #1,247,883 — here are the 5 players above and 5 below":\n  rank = ZREVRANK leaderboard player_id   (one round-trip)\n  ZREVRANGE leaderboard MAX(0, rank-5) rank+5 WITHSCORES  (one round-trip)\n\nTwo network hops, both O(log N). For paginated browse ("show me ranks 50,000-50,049"), ZREVRANGE handles it directly. We cache the top-100 page in the application for 1-2s because that page is ~80% of read traffic — the long tail of neighbourhood queries serves from Redis.\n\nGotcha: rank changes between the two calls under heavy update load. We tolerate the millisecond skew because the UX impact is invisible; if it matters, wrap both ops in a Lua script for atomicity.' },
      { section: 'Friend Leaderboard', content: 'Two implementations depending on friend-list size.\n\nSmall friend list (≤500, typical mobile): fetch each friend\'s score with one ZSCORE call pipelined, sort in-app. With pipelining this is one round-trip, ~3ms.\n\nLarger friend list or repeated query (social games with thousands of friends): build a per-player friend ZSET. On each friend\'s score update, also update the player\'s friend-leaderboards. Storage cost: average_friends × players × ZSET overhead — can be 10-100x more than the main leaderboard. We do this only for power users or games where friend leaderboards are the primary feature.\n\nZINTERSTORE between the global leaderboard and a friends SET can also work but materialising a result set per query is expensive; we avoid it at scale.' },
      { section: 'Time-Windowed Leaderboards', content: 'Daily, weekly, monthly, and all-time leaderboards live in separate ZSETs keyed by period: leaderboard:game:42:daily:20260614. Each score update writes to every relevant period in a MULTI. Rollover: at the end of the period, the ZSET becomes immutable — we copy the top-1000 to permanent storage (Postgres) for hall-of-fame records and let Redis evict the full set after a 14-day grace.\n\nDistinct periods means a single ZINCRBY becomes 4 ZINCRBYs (daily, weekly, monthly, all-time). At ~50K updates/sec, that is ~200K Redis ops/sec — still well within a single primary\'s budget.' },
      { section: 'Sharding Strategy', content: 'For 100M players in one game, a single Redis primary suffices (the dataset is ~6GB). Multi-game and multi-tenant systems shard by game_id (hash) — each game\'s leaderboard fits on one primary, hot games get their own dedicated nodes. The complication is global cross-game leaderboards ("Most XP this week across all games"): merge top-K from each shard.\n\nIf a single game exceeds one node (e.g. PUBG-scale with 500M+ players), shard by player_id range and keep a "summary" ZSET on a coordinator node with the top-N from each shard. Updates are dual-write: shard ZSET + the summary if the new score makes the cut. Reading top-N reads only the summary. Reading "my rank" hits the shard.' },
      { section: 'Persistence and Replication', content: 'Redis configured with AOF (appendonly yes, appendfsync everysec) — sub-second crash window. RDB snapshots taken hourly to S3 for disaster recovery. Replication: primary → 2 read replicas in the same AZ for HA, plus an async cross-region replica for DR.\n\nSentinel or Cluster manages failover with sub-10s recovery. During failover, writes queue in the scorer consumer (Kafka backpressure) and replay once the new primary is up. The leaderboard is rebuildable from the score history in Postgres as a last resort — full rebuild for 100M players takes ~30 minutes from a parallel Spark job.' },
      { section: 'Caching the Top of Board', content: 'The top-100 leaderboard is the hottest read path — easily 70% of all read traffic. We cache it in the application tier:\n  • Pull from Redis every 1-2 seconds with stampede protection (single-flight per process, mutex via Redis SETNX).\n  • Serve cached responses with the cache age in a header.\n  • Edge cache (CDN) for the top-10 with 1s TTL — keeps the front page out of our origin entirely.\n\nWe deliberately do not push real-time updates to the top-10 to every connected client; instead we WebSocket-push only when the viewer\'s own rank changes meaningfully or a new entrant joins the top. Push for 100M concurrent watchers on a busy weekend is the disaster path.' },
      { section: 'Anti-Cheat Integration', content: 'Score writes from the game client are never trusted. Scores are submitted by an authoritative game server (or signed by an attestation layer for client-authoritative games). Defences:\n  • HMAC signature on every score with a per-session secret.\n  • Reasonableness checks: score delta vs time elapsed in the match.\n  • Per-player rate limit (X scores/min).\n  • Out-of-band anti-cheat (e.g. BattlEye, EAC) score flags the player; flagged players get a leaderboard "shadow" — their score updates locally but is excluded from the public ZSET.\n\nWhen a cheating cluster is unwound, removing entries is a single ZREM per player; the rank of legitimate players above them adjusts automatically.' },
      { section: 'Observability', content: 'Metrics:\n  • zset_size per leaderboard.\n  • update_rate (ops/sec) per game.\n  • p99 score-write latency end-to-end (game event → visible in leaderboard).\n  • read_qps and cache_hit_ratio per leaderboard page.\n  • out_of_order_score_count (the GT flag rejects).\n  • redis_memory_used and eviction_count (must be zero for live leaderboards).\n\nAlerts: Redis primary memory > 85%, replica lag > 1s, failover events, anomalous spike in score updates from one player (cheater signal).' },
    ],
    diagram: `graph TB
    subgraph Clients
        Player[Player Client]
        Spectator[Spectator UI]
        GameServer[Game Server]
        Esports[Esports Broadcast]
    end
    subgraph Edge
        CDN[Edge Cache Top N]
        LB[Load Balancer]
    end
    subgraph Gateway
        APIGW[Leaderboard API]
        Auth[Auth Service]
    end
    subgraph Services
        ScoreSvc[Score Update Service]
        TopNSvc[Top N Query Service]
        RankSvc[Player Rank Service]
        NeighborhoodSvc[Neighborhood Query]
        FriendSvc[Friend Leaderboard]
        SeasonSvc[Season and Reset Service]
        AntiCheat[Anti Cheat Validator]
        ShardRouter[Shard Router Consistent Hash]
    end
    subgraph Async
        AOF[AOF Persistence]
        SnapshotJob[RDB Snapshot Job]
        SeasonRollover[Season Rollover Job]
        MergeTopN[Cross Shard Top N Merger]
    end
    subgraph Storage
        RedisShard1[(Redis ZSET Shard 1)]
        RedisShard2[(Redis ZSET Shard 2)]
        RedisShardN[(Redis ZSET Shard N)]
        FriendDB[(Friends Graph DB)]
        SeasonArchive[(Past Seasons Archive)]
        PlayerDB[(Player Profile DB)]
    end
    subgraph Analytics
        EventBus[Game Events Bus]
        Lake[(Data Lake)]
    end

    GameServer -->|ZINCRBY score| APIGW --> Auth
    APIGW --> AntiCheat
    AntiCheat --> ScoreSvc --> ShardRouter
    ShardRouter --> RedisShard1
    ShardRouter --> RedisShard2
    ShardRouter --> RedisShardN

    Player -->|GET top 10| CDN --> TopNSvc
    TopNSvc --> MergeTopN
    MergeTopN --> RedisShard1
    MergeTopN --> RedisShard2
    MergeTopN --> RedisShardN

    Player -->|GET my rank| APIGW --> RankSvc --> ShardRouter
    Player -->|GET neighborhood| APIGW --> NeighborhoodSvc --> ShardRouter
    Player -->|GET friend board| APIGW --> FriendSvc --> FriendDB
    FriendSvc --> RedisShard1

    Spectator --> CDN
    Esports --> APIGW

    APIGW --> SeasonSvc --> SeasonRollover --> SeasonArchive
    APIGW --> PlayerDB

    RedisShard1 --> AOF
    RedisShard1 --> SnapshotJob

    ScoreSvc --> EventBus --> Lake

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class RedisShard1,RedisShard2,RedisShardN,FriendDB,SeasonArchive,PlayerDB storage
    class AOF,SnapshotJob,SeasonRollover,MergeTopN async
    class CDN,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Redis ZSET vs SQL ORDER BY + RANK()', rationale: 'A SQL query ORDER BY score DESC with RANK() is correct but requires either a full sort on every read or a covering index that bloats with each update. Redis ZSET serves O(log N) rank and top-K from a skiplist in single-digit milliseconds at 100M entries. The cost is operating Redis as a tier of truth — replication, snapshots, and rebuild paths are non-trivial.' },
      { decision: 'Push real-time leaderboard updates vs poll', rationale: 'Pushing every change to every connected viewer is wasteful and fans out badly on hot games. Polling every 2-5 seconds with edge cache is dramatically cheaper and the UX is indistinguishable for non-competitors. Push is justified only for active competitive views (the viewer\'s own neighbourhood) where freshness matters.' },
      { decision: 'Materialised friend leaderboards vs computed on demand', rationale: 'Computing on demand from the global ZSET costs N ZSCOREs per friend per query — fine for ≤500 friends. Materialising a friend ZSET per player gives O(log N) reads but multiplies write fanout by avg_friend_count. Choose by friend-list size: compute on demand for casual games, materialise only for power users in social-first games.' },
      { decision: 'Composite-score tie-breaking vs lexicographic member ordering', rationale: 'Lexicographic ordering is free but the tie-break field has to be encoded into the member string, which forces a single member-naming convention across the system. Composite scores keep the member clean and let you tune tie-breaks (earliest wins, latest wins, deterministic random) but bump into IEEE-754 precision at extreme score ranges. Composite is the more flexible and common choice.' },
    ],
    keyTakeaways: [
      'Redis sorted sets give O(log N) rank queries at 100M entries — the workload is a near-perfect fit for the data structure',
      'GT-flag ZADD prevents out-of-order score messages from rolling back a higher value — a free correctness win',
      'Multi-period leaderboards (daily/weekly/all-time) are just parallel ZSETs written transactionally per update — Redis handles 4× fanout easily',
      'The top-100 is the hottest page; cache it at the app tier and at the edge with short TTL rather than pushing updates to every connected client',
      'Score writes must be authoritative (signed by the game server) — a leaderboard fed by client-trusted data is theatre, not a leaderboard',
      'Rebuildability from a durable score history in Postgres is the safety net when Redis loses state — keep that pipeline tested',
    ],
    faqs: [
      { question: 'Why Redis sorted sets rather than a relational DB?', answer: 'A leaderboard is fundamentally a rank query on an ever-changing score column. SQL can answer it with ORDER BY + RANK() but the index either needs to be maintained on every update (multi-millisecond per write on a 100M-row B-tree) or scanned on every read. Redis sorted sets do both — score lookup O(1), rank O(log N), top-K O(log N + K) — by maintaining a skiplist + hash purpose-built for the workload. At 100M players the difference is microseconds vs hundreds of milliseconds, plus Redis updates are atomic without explicit transactions.' },
      { question: 'How does ZINCRBY avoid race conditions?', answer: 'Redis runs commands single-threaded against the keyspace, so ZINCRBY leaderboard 50 player:99 is atomic from the caller\'s perspective — no two clients can interleave a read-modify-write on the same member. For more complex updates (compare-and-set, conditional double-write to multiple ZSETs) we use Lua scripts via EVAL, which Redis runs as a single uninterruptible step. The atomicity is at the Redis-command level; you do not need MULTI/EXEC for single-command atomicity.' },
      { question: 'What happens to a player\'s rank when scores update at 50K writes per second?', answer: 'Every write that beats a player above moves them up by one and shifts everyone in between by one. Redis tracks this for free via the skiplist — ZREVRANK is always current. What does cost real money is broadcasting rank deltas to every viewer; we deliberately do not push every individual change. Instead, the client polls every 2-5 seconds and the server batches all changes into a single delta payload. For 100M players the average rank changes constantly but visually only the top-100 page moves enough for anyone to notice.' },
      { question: 'How do you handle score submissions from cheaters?', answer: 'Score writes are accepted only from authenticated game servers (or attested clients) with an HMAC signature per session. Server-side checks: score delta is reasonable for the elapsed match time, max-per-player rate limit, anti-cheat flags from the runtime. When a cheating account is identified we ZREM their entries — rank of legitimate players above them updates atomically because of how the skiplist re-links. For mass-cheat takedowns we do them in batches during quiet periods and announce the leaderboard reshuffle.' },
      { question: 'Why use the GT flag on ZADD?', answer: 'Score events can arrive out of order (network reordering, retry of an older webhook, multi-region replication lag). Without GT, a delayed older event would overwrite a newer higher score and the player would silently lose progress. With GT (Greater Than), Redis only updates if the new score exceeds the existing one — making the operation an idempotent monotonic upsert. The cost is one extra comparison per write, negligible. Use LT for "lowest time" leaderboards (race game finish times).' },
      { question: 'How do you do daily and weekly leaderboards efficiently?', answer: 'Each period is its own ZSET keyed by the period (leaderboard:game:42:daily:20260614). On each score event we issue a MULTI that writes the all-time and the active period ZSETs together — atomic from the consumer\'s perspective. At the end of each period, the ZSET becomes read-only; we copy the top-1000 to Postgres for permanent hall-of-fame records and expire the full set from Redis after a 14-day grace. Memory and op cost scale linearly with periods tracked, but Redis comfortably absorbs 4-5× fanout.' },
      { question: 'How would you scale beyond a single Redis primary?', answer: 'A single primary holds ~6GB for 100M players and serves hundreds of thousands of ops/sec — surprisingly far. Beyond that: shard by game_id so each game has dedicated nodes, with cross-game queries running scatter-gather. If a single game exceeds one node, shard by player_id range and maintain a summary ZSET of the top-1000 on a coordinator node — global top-N reads only the summary, "my rank" hits the shard. Avoid Redis Cluster sharding of one ZSET — ZSETs cannot span shards, and re-sharding live moves all members.' },
      { question: 'What about persistence — what happens if Redis crashes?', answer: 'AOF with appendfsync everysec gives at most one second of write loss. RDB hourly snapshots ship to S3 for DR. Replicas in the same AZ make HA failover sub-10s; a cross-region async replica supports regional failover. Crucially, the leaderboard is rebuildable: we keep every score submission in Postgres (or Kafka with long retention) and can re-derive the ZSET from that history with a Spark job in roughly 30 minutes for 100M players. Test the rebuild quarterly so it actually works when needed.' },
      { question: 'Why don\'t you push the leaderboard to every connected client in real time?', answer: 'Two reasons. (1) Bandwidth: a top-100 leaderboard at 100KB delivered to 1M concurrent viewers every time it changes is petabytes a day — pointless because viewers cannot perceive sub-second changes anyway. (2) The top-100 churns constantly; pushing every micro-shuffle adds CPU pressure for zero UX benefit. We push only meaningful events to specific clients: "you entered the top 10", "your friend overtook you", "a new #1 has been crowned". The top-100 list itself is polled with a CDN edge cache and 1-2s TTL.' },
      { question: 'How do you tie-break players with the same score?', answer: 'Encode the tie-break field into the score as a composite. Example: combined_score = score × 1e10 + (1e10 - first_reached_timestamp_ms). The integer part is the displayed score; the fractional/lower bits order ties by who got there first. Watch out for IEEE-754 precision — doubles give 15-17 significant decimal digits, so cap the total range. Alternatively, append the timestamp to the member string (player_id format: "20260614T093212-player99") and rely on Redis\'s lexicographic tie-break — simpler but requires every consumer to parse the member format.' },
    ],
  },
  {
    id: 31,
    slug: 'design-llm-inference-service',
    title: 'Design an LLM Inference Service',
    difficulty: 'Hard',
    category: 'AI & Machine Learning',
    tags: ['llm', 'gpu', 'batching', 'kv-cache', 'streaming', 'inference'],
    problemStatement: `Design a production LLM inference service (like the OpenAI or Anthropic API) that serves large language models to external developers. The system must handle concurrent token-streaming requests, maximise GPU utilisation, and enforce per-customer rate limits. Target: 10M API requests/day, P50 time-to-first-token < 500ms, P99 < 2s.`,
    requirements: {
      functional: ['Accept a prompt and return a streamed token response', 'Support multiple models (e.g. 7B, 70B, 405B parameter variants)', 'Per-customer API key authentication and rate limiting', 'Usage metering (tokens in / tokens out) for billing', 'Cancel in-flight requests'],
      nonFunctional: ['P50 time-to-first-token < 500ms', 'GPU utilisation > 70%', '99.9% availability', 'Support 10M requests/day (~115 rps average, 1000 rps peak'],
    },
    capacityEstimates: `Requests: 10M/day ≈ 115 rps avg, 1000 rps peak\nAvg prompt: 500 tokens in, 500 tokens out\nTotal tokens/day: 10M × 1000 = 10B tokens\nA100 GPU: ~3000 tokens/sec for a 7B model (batch=32)\nGPUs needed (7B): 10B / (3000 × 86400) ≈ 40 A100s for 7B; 10× more for 70B`,
    solutionBreakdown: [
      { section: 'API Design', content: 'OpenAI-compatible HTTP surface (the de facto standard):\n  POST /v1/chat/completions { model, messages[], max_tokens, temperature, stream, stop[], tools[]?, response_format? }\n  POST /v1/completions       (legacy raw completion)\n  POST /v1/embeddings        (separate model class, different infra)\n  GET  /v1/models            (lists available model IDs and context windows)\n  POST /v1/chat/completions  with stream=true → Server-Sent Events (SSE) chunked stream of token deltas\n\nEvery request carries an Authorization: Bearer <api_key>. Streaming uses SSE rather than WebSocket because HTTP/2 fan-out scales much better at the load balancer and the connection is unidirectional anyway. Cancellation: client closes the SSE stream; gateway forwards an abort to the scheduler which marks the request slot for early eviction.' },
      { section: 'Prefill vs Decode: Two Different Workloads', content: 'A single request has two phases the GPU treats very differently.\n\nPrefill: process the entire prompt (potentially 32K tokens) through the model once to populate the KV cache. Compute-bound — saturates GPU FLOPS, especially for long prompts. A 32K-token prefill on a 70B model takes hundreds of milliseconds on an H100.\n\nDecode: generate one token at a time, each step doing one forward pass against the cached KVs. Memory-bandwidth-bound — the bottleneck is reading the KV cache from HBM, not the compute. Each decode step is sub-10ms; 500 output tokens at 50 tok/s = 10 seconds.\n\nOptimising for one mode hurts the other. Production systems route prefill-heavy and decode-heavy traffic differently and tune batching, parallelism, and SLO targets accordingly.' },
      { section: 'Continuous Batching', content: 'The naive batching strategy is "static": pad every request to the longest in the batch, run forward passes until all are done, then dispatch the next batch. Problem: if one sequence finishes at token 50 and another at token 500, the first sequence\'s GPU slot sits idle for 450 steps. Continuous batching (Orca / vLLM) maintains a running batch where each forward pass operates on a heterogeneous set of in-flight sequences. The moment a sequence emits its end-of-text token, the scheduler reclaims its slot and admits a queued request the next iteration. GPU utilisation jumps from ~25% to >75%. The complication is mixed prefill/decode batches: prefill steps for new admissions and decode steps for incumbents run together in the same forward pass via chunked prefill or two-step scheduling.' },
      { section: 'PagedAttention and KV Cache', content: 'The KV cache is the per-request attention memory: for each layer, two tensors of shape [seq_len, num_heads, head_dim]. For a 70B model with 32K context, the cache is ~10 GB per request. Naïve allocation reserves max_context contiguously per sequence — most of it unused, fragmenting GPU memory.\n\nPagedAttention manages the KV cache as fixed-size blocks (e.g. 16 tokens per block), analogous to OS virtual memory pages. Each sequence has a "block table" mapping logical token positions to physical blocks. Benefits:\n  • No fragmentation — blocks are uniform.\n  • Copy-on-write sharing for prompt prefixes — multiple sequences sharing a system prompt physically share its KV blocks.\n  • LRU eviction to CPU RAM under pressure (swap), with a small recompute fallback.\n\nThis is the technique that 2-4×ed concurrent request density and made vLLM the open-source standard.' },
      { section: 'Model Parallelism', content: 'Model size vs GPU memory dictates the parallelism strategy.\n\nTensor parallelism: each weight matrix W ∈ R^(d×d) is sharded column-wise across N GPUs; each GPU computes Y_i = X · W_i and an all-reduce sums them. Communication cost is one all-reduce per layer, but within an NVLink-connected node (8× H100, ~900 GB/s NVLink) this is negligible. TP=4 or TP=8 within a node.\n\nPipeline parallelism: contiguous layers assigned to different GPUs. A request flows through them in sequence. Lower communication (one transmit per stage transition) but introduces bubbles when the pipeline is not full. Used across nodes where NVLink does not span.\n\nFor a 405B model, typical layout: TP=8 within a node, PP=4 across 4 nodes, total 32 GPUs serving one model replica. The decision is dictated by NVLink topology, not preference.' },
      { section: 'Quantisation and Compilation', content: 'Quantisation: store weights in lower precision to fit more model per GPU and increase memory bandwidth efficiency. Common: FP16 (default), FP8 (H100+), INT8 (W8A8), INT4 (weight-only, e.g. AWQ/GPTQ). Each step halves memory at ~1-3% quality cost; INT4 weight + FP16 activation is the production sweet spot for serving 70B+ models on a single H100.\n\nCompilation: the model graph is captured (TorchInductor, TensorRT-LLM, vLLM\'s torch.compile path) into a fused kernel sequence with custom CUDA kernels for attention (FlashAttention-2, FlashInfer), GEMM, and softmax. Compilation gives 1.5-3× throughput over eager-mode PyTorch. Warm-up time is non-trivial (minutes) so we compile once at deploy time and bake into the container image.' },
      { section: 'Speculative Decoding', content: 'Decode-step throughput is memory-bound — the GPU is largely waiting on HBM reads. Speculative decoding uses a small "draft" model (say 1B) to generate K tokens cheaply, then the large model verifies all K in a single parallel forward pass. If most drafts are accepted, the effective tokens/sec is multiplied by the acceptance rate.\n\nIn practice: 1.5-2.5× decode throughput for chat workloads where the draft model agrees with the target most of the time. Code generation gets less benefit because the distribution is sharper. EAGLE / Medusa are draft-free variants that train extra heads on the target model itself, removing the deployment overhead of a second model.' },
      { section: 'Routing, Rate Limiting, and Multi-Model Fleets', content: 'The gateway authenticates the API key (KV lookup, cached), checks per-key token-bucket rate limits in Redis (requests-per-minute and tokens-per-minute), routes to the right model cluster by the model field, and forwards to a least-loaded scheduler instance.\n\nFor models with multiple replicas, route by load-aware least-outstanding-requests rather than round-robin — a single long generation can hog a GPU for tens of seconds and round-robin distributes it badly. We also keep a "cold spare" replica per model that warms up on demand for spike absorption.\n\nMulti-tenancy: noisy-neighbour mitigation by enforcing per-tenant fair-share on the queue (weighted fair queueing across keys) so one customer\'s long batch cannot starve another\'s interactive request.' },
      { section: 'Streaming and Cancellation', content: 'SSE stream format: each token (or chunk of tokens) is written as data: { "choices": [{ "delta": { "content": "..." } }] }\\n\\n. Final chunk is data: [DONE]. The gateway holds an open HTTP connection from client to scheduler — at 1000 rps with 10s average generation, that is 10K concurrent connections per gateway, well within an HTTP/2 server\'s capacity.\n\nCancellation is critical because users abort generations frequently (refresh, change prompt). When the client closes the SSE stream, the gateway propagates an abort signal to the scheduler; the scheduler marks the request for eviction at the next iteration boundary. Wasted GPU cycles for cancellations are real money — 20% cancellation rate × 10s average = 20% of the GPU bill — so abort latency below 100ms is a P0 metric.' },
      { section: 'Storage and Caching', content: 'Most LLM requests share prefixes. The most valuable cache layer is prompt prefix caching: store KV cache blocks computed for common prefixes (system prompts, few-shot examples, document context in RAG) and reuse them across requests via PagedAttention\'s shared blocks. Cache hit on a 4K system prompt skips a 100-200ms prefill — huge.\n\nResponse cache: exact-match cache on (model, prompt, parameters) → completion. Hit rate is low for chat but non-trivial for embeddings and classification calls. Honour the deterministic parameter (temperature=0) only — never cache stochastic completions.\n\nModel weights live on local NVMe (loaded into GPU at startup). API key and rate-limit state in Redis. Usage records in ClickHouse (cheap append for billing).' },
      { section: 'Observability and Autoscaling', content: 'SLIs that page on-call:\n  • Time to first token (TTFT) p50/p99 — proxy for prefill latency and queue depth.\n  • Inter-token latency (ITL) p99 — decode-step health.\n  • Per-replica GPU utilisation (SM occupancy, not just nvidia-smi util).\n  • KV cache occupancy — close to 100% means new requests will block.\n  • Queue depth and queue dwell time by priority.\n  • Error rate by failure class (rate-limited, OOM, kernel timeout).\n\nAutoscaling on queue dwell time (p95 dwell > 500ms for 2 minutes ⇒ scale up). Spot/preemptible GPUs absorb the tail of bursty traffic; the on-demand baseline holds steady. Drain handlers stop admitting new requests on shutdown and let in-flight generations finish before terminating.' },
      { section: 'Cost Economics', content: 'Inference economics are dominated by GPU-hours per million output tokens. Levers:\n  • Continuous batching + paged KV: 3× throughput per GPU. Free.\n  • Quantisation (FP8/INT8): 2× throughput, 1-3% quality cost. Tunable per model.\n  • Speculative decoding: 1.5-2× decode throughput. Adds complexity.\n  • Prefix caching: 10-50% prefill savings on workloads with shared prompts (RAG, agents).\n  • Smaller model first, escalate on uncertainty: route easy queries to a cheap model, only fall back to the expensive one when needed.\n\nBilling: token counters per request feed a metering pipeline; charge as input_tokens × in_price + output_tokens × out_price + cached_token_discount. Reconcile daily against the GPU bill — if per-token cost diverges, find the bug.' },
    ],
    diagram: `graph TB
    subgraph Clients
        DevA[Developer App]
        ChatUI[Chat UI]
        Batch[Batch Inference Job]
    end
    subgraph Edge
        LB[Global Load Balancer]
        SSE[SSE and WebSocket Streaming]
    end
    subgraph Gateway
        APIGW[API Gateway]
        Auth[API Key Auth]
        TokenBucket[Token Bucket Rate Limit Redis]
        ModelRouter[Model Cluster Router]
    end
    subgraph Services
        Scheduler[Inference Scheduler]
        ContBatch[Continuous Batcher]
        PrefillEng[Prefill Engine]
        DecodeEng[Decode Engine]
        TPCluster7B[Tensor Parallel Cluster 7B]
        TPCluster70B[Tensor Parallel Cluster 70B]
        PPCluster405B[Pipeline Parallel 405B]
        PagedAttn[Paged Attention Manager]
        CancelSvc[Cancellation Service]
    end
    subgraph Async
        Queue[Request Queue Redis or Kafka]
        Meter[Usage Metering Aggregator]
        Autoscaler[GPU Pod Autoscaler]
        SpotBatch[Spot GPU Batch Pool]
        WarmUp[Model Warmup Loader]
    end
    subgraph Storage
        KVCache[(KV Cache GPU HBM)]
        CPUSwap[(CPU RAM KV Swap)]
        ModelWeights[(Model Weights NFS or S3)]
        BillingDB[(Billing and Usage DB)]
        RateLimitRedis[(Rate Limit Redis)]
    end
    subgraph Analytics
        EventBus[Inference Telemetry Bus]
        Metrics[(Prom Metrics Store)]
        Dash[Grafana Dashboards]
    end

    DevA -->|POST chat| LB --> APIGW
    ChatUI --> LB
    Batch --> LB
    APIGW --> Auth
    APIGW --> TokenBucket --> RateLimitRedis
    APIGW --> ModelRouter
    ModelRouter --> Queue --> Scheduler

    Scheduler --> ContBatch
    ContBatch --> PrefillEng
    ContBatch --> DecodeEng
    ContBatch --> PagedAttn --> KVCache
    PagedAttn -.->|swap LRU| CPUSwap

    Scheduler -->|7B request| TPCluster7B --> ModelWeights
    Scheduler -->|70B request| TPCluster70B --> ModelWeights
    Scheduler -->|405B request| PPCluster405B --> ModelWeights

    TPCluster7B -->|stream tokens| SSE --> DevA
    TPCluster70B --> SSE --> ChatUI
    PPCluster405B --> SSE

    DevA -.->|cancel| CancelSvc --> Scheduler

    APIGW -->|tokens in and out| Meter --> BillingDB
    Queue --> Autoscaler --> TPCluster7B
    SpotBatch --> Batch
    WarmUp --> ModelWeights

    Scheduler --> EventBus --> Metrics --> Dash

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class KVCache,CPUSwap,ModelWeights,BillingDB,RateLimitRedis storage
    class Queue,Meter,Autoscaler,SpotBatch,WarmUp async
    class LB,SSE edge
    class EventBus,Metrics,Dash analytics`,
    tradeoffs: [
      { decision: 'Continuous batching vs static batching', rationale: 'Static batching is trivial to implement but leaves the GPU idle whenever sequences in a batch finish at different times — typical 25-30% utilisation. Continuous batching is significantly more complex (scheduler with mixed prefill/decode passes, dynamic KV cache management) but is the only way to reach the 70%+ utilisation that makes serving economically viable. There is no production-grade modern LLM server without it.' },
      { decision: 'Tensor parallelism vs pipeline parallelism', rationale: 'Tensor parallelism has no pipeline bubbles and lower latency per token, but its all-reduce per layer demands high-bandwidth interconnect (NVLink). Pipeline parallelism tolerates slower interconnects but adds startup latency and complicates batching. Standard production layout: TP within an NVLink-connected node, PP across nodes — driven by the topology, not preference.' },
      { decision: 'INT8/FP8 quantisation vs full FP16', rationale: 'Quantisation roughly doubles throughput per GPU and lets larger models fit on smaller hardware. Quality cost is usually 1-3% on standard benchmarks and often invisible to users. The case for full FP16 is shrinking — quantisation-aware kernels (FlashAttention with FP8, INT8 GEMM) close the quality gap further. The only reason to stay FP16 is regulated or research workloads where exact reproducibility matters.' },
      { decision: 'Speculative decoding vs straightforward decoding', rationale: 'Speculative decoding multiplies decode throughput by 1.5-2.5× on chat workloads but adds a second model to deploy and a more complex scheduling path. For high-volume serving the savings dwarf the operational cost; for low-volume or research models it is not worth it.' },
      { decision: 'Single shared cluster vs per-model dedicated clusters', rationale: 'A shared cluster simplifies operations but creates noisy-neighbour issues and complicates parallelism choices when models have different shape requirements. Per-model dedicated clusters give predictable latency and clean autoscaling at the cost of fragmented capacity. Most providers run dedicated clusters for the flagship model and a shared pool for long-tail variants.' },
    ],
    keyTakeaways: [
      'Continuous batching plus PagedAttention is the foundation of every serious LLM-serving stack — they are non-negotiable for 70%+ GPU utilisation',
      'Prefill and decode are different workloads with different bottlenecks (compute vs memory bandwidth); SLOs and autoscaling should be defined per phase',
      'Time-to-first-token and inter-token-latency are the two latency SLIs that matter — averaging them hides the user experience',
      'Quantisation (FP8/INT8/INT4) is the highest-ROI cost lever after batching — 2× throughput at typically <3% quality cost',
      'Prefix caching exploits the shared-prompt structure of RAG and agent workloads — a 10-50% prefill-cost reduction with almost zero downside',
      'Streaming cancellation must be a P0 metric — wasted GPU cycles on cancelled generations are directly proportional to wasted dollars',
    ],
    faqs: [
      { question: 'What exactly is the KV cache and why is it the memory bottleneck?', answer: 'Transformer attention computes Q × K^T at each step. To avoid recomputing K and V for all prior tokens on every decode step, we cache them per layer in HBM. For a 70B model with 80 layers, ~64 heads, head_dim=128, and 32K context, each request\'s KV cache is roughly 10 GB. That dwarfs the model weights for long contexts and is why concurrent request density is governed by KV memory, not model size. PagedAttention treats this cache like virtual memory — fixed-size blocks managed by a block table — to eliminate fragmentation and enable cross-request prefix sharing.' },
      { question: 'Why is decode memory-bound while prefill is compute-bound?', answer: 'Prefill processes the entire prompt as a matrix-matrix multiplication — a large GEMM that saturates GPU FLOPS. Decode processes one token at a time, so each forward pass is a matrix-vector multiplication: arithmetic intensity is low, the GPU mostly reads weights and the KV cache from HBM. HBM bandwidth on an H100 is ~3 TB/s; even at peak, a 140 GB FP16 model needs ~50 ms per decode step on one GPU just for weights — which is why we batch decodes (read weights once, reuse for many sequences). Prefill optimisations chase FLOPS; decode optimisations chase memory bandwidth.' },
      { question: 'How does continuous batching actually work?', answer: 'The scheduler maintains a "running set" of in-flight sequences plus a queue of pending requests. Each iteration: (1) build a batch from the running set, mixing decode steps for existing sequences and prefill chunks for newcomers; (2) execute one forward pass; (3) sample tokens, append to each sequence; (4) evict any sequence that emitted EOS or hit max_tokens; (5) admit queued requests into the freed slots, allocating fresh KV blocks. The clever bit is the mixed-batch forward pass — engineering a kernel that handles variable-length inputs without padding. vLLM and TGI both implement this; the open-source state of the art is well-documented.' },
      { question: 'When do you choose TP=8 vs PP=8?', answer: 'TP wins when the GPUs are NVLink-connected because the per-layer all-reduce is fast (microseconds). PP wins across slower interconnects (PCIe, RDMA) because it only transmits at stage boundaries. The standard layout for a single replica of a large model: TP within a node (8 GPUs, ~900 GB/s NVLink), PP across nodes if needed. A 405B model with FP16 weights = 810 GB → needs at least 11 H100 80GB → typically TP=8 × PP=2 across 16 GPUs. The geometry is driven by the hardware topology, not by preference.' },
      { question: 'What is speculative decoding and when does it help?', answer: 'A small draft model (e.g. 1B) generates K tokens greedily; the target model (e.g. 70B) verifies all K in one parallel forward pass by scoring the joint sequence. Tokens with sufficient match are accepted; the first rejected token is resampled from the target distribution. If the acceptance rate is 70-80% (typical for chat), effective tokens/sec on the target multiplies by ~1.5-2.5×. It helps most on memory-bound decode workloads where the target GPU was idle on HBM reads. It helps less on highly structured generation (code, JSON) where the small model diverges quickly.' },
      { question: 'How do you handle requests that need a 100K-token context?', answer: 'Long context is mostly a prefill problem — processing 100K tokens through a 70B model can take seconds. Optimisations: chunked prefill (process the prompt in chunks interleaved with decode steps of other sequences so we never block decode-only traffic), FlashAttention-2 (memory-efficient attention that handles long sequences without quadratic memory blowup), and prefix caching (the system prompt and document context for repeat users hit cached KV blocks). For truly long contexts (1M tokens), sliding-window attention or ring attention spreads the prefill across GPUs. The KV cache for a 100K-token request can exceed 30 GB — capacity planning has to account for it.' },
      { question: 'How do you bill accurately under streaming?', answer: 'The scheduler emits per-request token counters (input_tokens at prefill end, output_tokens incrementally on each decode step). A metering service consumes these and writes them to a billing event log (Kafka → ClickHouse). On request completion we emit a final usage event with the totals; for cancelled streams we charge for tokens already streamed. The end-of-day reconciliation joins usage events against the actual GPU bill — divergence > 2% triggers an investigation. Tokens are counted with the model\'s own tokenizer (not whitespace) for parity with what the customer\'s SDK reports.' },
      { question: 'Why use SSE rather than WebSocket for streaming?', answer: 'SSE is unidirectional (server → client), which matches the workload exactly — clients send one request and receive a stream of tokens. SSE multiplexes naturally over HTTP/2 (one connection, many concurrent streams), so the gateway can hold tens of thousands of open SSE connections per process. WebSockets work but add bidirectional framing complexity, more aggressive proxy handling, and the connection state is harder to balance across replicas. For OpenAI-compatible APIs SSE is also the de facto standard, so client SDKs just work.' },
      { question: 'How do you prevent a noisy customer from starving others?', answer: 'Multiple layers. Per-key rate limits at the gateway (requests-per-minute and tokens-per-minute, enforced via Redis token bucket). Weighted fair queueing on the scheduler input so one customer\'s 100-request batch interleaves with another customer\'s 1-request interactive call. Per-tenant max-concurrent-requests cap so a single key cannot occupy more than X% of GPU slots. For abuse cases, we shadow-throttle: serve the request but with degraded priority. Hard 429s only as a last resort because they show up as a customer-facing failure.' },
      { question: 'What is prefix caching and when does it pay off?', answer: 'PagedAttention\'s block-based KV cache supports physical sharing: if two requests start with the same 4K-token system prompt, their first 256 blocks (at 16 tokens/block) literally point to the same physical GPU memory. The second request skips that 100-200ms of prefill entirely. Pays off whenever prompts share structure: RAG (the retrieved context dominates the prompt and recurs across sessions), agents (long system prompts), and few-shot classification (fixed examples). For pure free-form chat the cache hit rate is low. Implementation is essentially free — vLLM does this by hashing prefixes and reference-counting blocks.' },
    ],
  },
  {
    id: 32,
    slug: 'design-rag-system',
    title: 'Design a Retrieval-Augmented Generation (RAG) System',
    difficulty: 'Hard',
    category: 'AI & Machine Learning',
    tags: ['rag', 'vector-search', 'embeddings', 'llm', 'chunking', 're-ranking'],
    problemStatement: `Design a RAG system that lets users ask natural-language questions over a large private document corpus (e.g. a company's entire knowledge base — wikis, PDFs, Slack threads). The system retrieves the most relevant passages, injects them into an LLM prompt, and returns a grounded answer with source citations. Target: 10M documents, < 2s end-to-end latency, answers grounded in retrieved context.`,
    requirements: {
      functional: ['Ingest documents from multiple sources (PDF, HTML, Markdown)', 'Answer natural-language questions with cited sources', 'Support incremental updates (new/edited/deleted documents)', 'Return top-K source passages alongside the answer', 'Per-user access control (only surface documents the user can see)'],
      nonFunctional: ['< 2s end-to-end latency', 'Retrieval recall@5 > 80%', '99.9% availability', '10M documents, ~500 tokens each'],
    },
    capacityEstimates: `Documents: 10M × 500 tokens × 4B/token ≈ 20 GB raw text\nEmbeddings: 10M × 1536 dims × 4B = 60 GB vectors\nIngestion: assume 100K new/updated docs/day ≈ 1.2 docs/sec\nQuery: 100 QPS × (embed + ANN + LLM) latency budget`,
    solutionBreakdown: [
      { section: 'API Design', content: 'Two surfaces — ingestion (mostly internal/admin) and query (user-facing):\n  POST /documents { source_uri, mime_type, acl_tags[], metadata }  → enqueues async ingestion\n  DELETE /documents/{doc_id}  (cascades to all chunks)\n  POST /query { question, user_id, conversation_id?, filters? }  → returns { answer, citations[], confidence }\n  POST /query  with stream=true → SSE stream of answer tokens, followed by a final citations event\n  GET  /documents/{doc_id}/status  (ingestion progress)\n\nThe query API enforces auth before retrieval — the user\'s identity and group memberships are passed into the vector search as metadata filters. Citations include doc_id, chunk_id, and a clickable deep link with anchor.' },
      { section: 'Document Ingestion Pipeline', content: 'Ingestion is asynchronous and idempotent. Stages, each backed by Kafka topics:\n  1. Crawl/Receive: sources push to /documents or are pulled from connectors (S3, Confluence, Notion, Slack, Drive). Webhooks fire on source changes.\n  2. Parse: format-specific parsers — Apache Tika for PDFs (including OCR for scanned), Unstructured.io for HTML/DOCX, custom parsers for Slack threads. Output is normalised plaintext + structural metadata (headings, page numbers, anchors).\n  3. Chunk: see chunking section.\n  4. Embed: batch-call the embedding model (typically 100-256 chunks per call to amortise GPU latency).\n  5. Index: write vectors + metadata to the vector DB; write original chunk text and full document to S3.\n\nEach stage is at-least-once with idempotency keyed by (doc_id, version_hash) so retries do not duplicate chunks. A document gets a content_hash; if unchanged on re-crawl we skip the pipeline.' },
      { section: 'Chunking Strategy', content: 'Chunking is the single most impactful parameter for answer quality. Naive fixed-size chunking (split every 512 tokens) breaks sentences and scatters context. Better:\n\n1. Structural chunking: split first on document structure (chapters → sections → paragraphs). Each chunk gets a "breadcrumb" of its parents in the metadata.\n2. Semantic merging: if a paragraph is short, merge with neighbours up to a target size (~500 tokens). If a paragraph exceeds the target, sub-split on sentence boundaries.\n3. Overlap: 10-15% token overlap between adjacent chunks preserves context across boundaries.\n4. Parent-document retrieval: index small chunks (128 tokens) for high-precision retrieval, but return the parent section (512 tokens) to the LLM for context. Decouples retrieval signal from answer context.\n\nTables, code blocks, and figures need special handling — never split mid-table. Code blocks retain language tags. Tables are converted to markdown for the LLM and the structured form is stored as metadata for downstream filtering.' },
      { section: 'Embeddings and the Embedding Model', content: 'Choice of embedding model determines the recall ceiling. Production options:\n  • OpenAI text-embedding-3-large (3072 dims, paid API, strong general performance).\n  • Cohere embed-v3 (1024 dims, good multilingual).\n  • Open-source: BGE-large, GTE-large, E5-mistral (768-1024 dims, self-hosted).\n\nThe choice locks in the index — vectors from model A are not comparable with vectors from model B. Migrating models requires re-embedding the entire corpus, so pick deliberately. Embeddings are normalised to unit length so cosine similarity = dot product (cheaper to compute).\n\nMatryoshka embeddings (2024+) emit nested dimensionalities (e.g. 256/512/1024/3072) from one forward pass — you can store the full 3072 for accuracy and truncate to 256 for fast first-pass retrieval, then re-rank with the full vector.' },
      { section: 'Vector Index and Retrieval', content: 'The vector store is the hot path: at 10M chunks × 1536 dims × 4B = 60 GB, an HNSW index in a managed vector DB (Pinecone, Weaviate, pgvector, Qdrant) or in-process (FAISS) serves top-50 ANN search in <30ms.\n\nQuery flow:\n  1. Embed the user question with the same model used at ingestion.\n  2. Construct metadata filter: { acl_tags: { $in: user_groups }, ...user_supplied_filters }.\n  3. ANN search with filter — production systems use a filtered HNSW traversal so post-filter rejections do not require re-running the search.\n  4. Return top-50 candidates with similarity scores and metadata.\n\nKey: never apply ACL filtering after retrieval. A document the user cannot see should never be a candidate, because the vector itself can leak information (semantic similarity to the question is a side channel).' },
      { section: 'Hybrid Search: Vector + Lexical', content: 'Pure vector search misses exact-match queries — code identifiers, error codes, product SKUs, named entities. Add a BM25 lexical index (Elasticsearch / OpenSearch / Tantivy) running on the same chunks. At query time, fan out to both indices and fuse the result lists.\n\nFusion methods:\n  • Reciprocal Rank Fusion (RRF): score(d) = Σ 1/(k + rank_i(d)) for each retriever i. k≈60. Simple, robust, no calibration needed.\n  • Weighted score combination: requires score normalisation across retrievers; brittle.\n\nRRF is the default in production. The combined recall@50 jumps 5-15 percentage points over either alone on enterprise corpora.' },
      { section: 'Re-ranking', content: 'ANN gives candidates; the re-ranker decides the final order. A cross-encoder reads (query, chunk) as one input and scores them jointly via cross-attention — far more accurate than bi-encoder cosine similarity. Options:\n  • Cohere Rerank-3 (managed API, ~100ms for 50 candidates).\n  • BGE-reranker-large (self-hosted, ~50ms on a single T4 with INT8).\n  • Mixedbread mxbai-rerank-large.\n\nWe re-rank top-50 to top-5 (or top-3 for tight context windows). For high-stakes queries we go further: a final LLM-based judge re-ranks the top-5 by asking GPT-4 / Claude to evaluate relevance — another 200ms and significant quality lift on hard queries. Cache re-ranking results keyed by (question_hash, candidate_set_hash) for 10 minutes.' },
      { section: 'Prompt Assembly and Generation', content: 'The final prompt is structured: \n  [System] You are a helpful assistant that answers using only the provided sources. If the sources do not contain the answer, say so. Cite each claim with [Source N].\n  [Source 1] <chunk text> (from doc_id=…, page=…)\n  [Source 2] ...\n  [User] <question>\n  [Conversation history] (last N turns, summarised if long)\n\nKey practices: pin the model to a temperature ≤ 0.3 (RAG is not a creative task), instruct it explicitly to refuse if context is insufficient (reduces hallucination), and number sources for inline citations. Token budget: leave at least 1K tokens for the answer; if context is too long, drop lower-ranked sources rather than truncating any single one.' },
      { section: 'Citation Extraction and Grounding Verification', content: 'After generation, parse the response for [Source N] markers and map them to the original chunks. Render the UI with clickable citations linking to the source document at the right anchor.\n\nGrounding verification: for each sentence in the answer, check that it is supported by at least one cited source. Implementations range from simple substring overlap to an LLM judge ("is this sentence supported by source X?"). Unsupported sentences are flagged in the UI and counted as hallucinations in evaluation.\n\nFor regulated domains, refuse to surface any sentence that lacks a grounding match. The system prompt says "cite or refuse" and we enforce it server-side.' },
      { section: 'Access Control', content: 'Documents inherit ACLs from their source (Confluence space permissions, Slack channel membership, file ACLs). The ingestion pipeline normalises these to a set of acl_tags on every chunk (e.g. group:engineering, channel:incidents, user:alice).\n\nAt query time the gateway resolves the requesting user to their group set and passes it as a filter to the vector DB. Critical rules:\n  • ACL changes in the source must propagate to chunks within minutes (event-driven, not nightly). Stale permissions are a leak.\n  • Deletes are immediate — when a document is removed or unshared, its chunks must be either deleted or tombstoned and excluded.\n  • Re-shares (granting access) just take effect on the next query — no rebuild needed.\n\nDo not rely on the LLM to "not cite" inaccessible docs; the candidates must be pre-filtered.' },
      { section: 'Incremental Updates and Versioning', content: 'Documents change. Strategy:\n  • On update, the source emits a change event (via webhook or polling for systems without events).\n  • Re-parse and re-chunk. Compute a content_hash per chunk.\n  • Diff the new chunk set against the previous: insert new chunks, update changed ones (which means a new embedding), delete removed ones.\n  • Vector DB upserts by chunk_id are O(log N) in HNSW; deletes use tombstones with periodic compaction.\n\nFor large corpora (>100M chunks), batch updates and apply in micro-batches every 30s to amortise index maintenance overhead. The version of a chunk is tracked so a query result can be tied back to the exact text that scored well — important for debugging changes in answer quality.' },
      { section: 'Evaluation: How Do You Know It Works?', content: 'RAG fails silently — the LLM produces a plausible-looking answer from irrelevant context. Continuous eval is non-negotiable.\n\nGolden set: 100-1000 (question, expected_answer, expected_sources) triples curated by SMEs. Metrics computed nightly:\n  • Retrieval recall@K: does the top-K retrieve at least one expected source?\n  • Faithfulness: are all claims in the answer supported by cited sources? (LLM judge or NLI model).\n  • Answer correctness: does the answer match the expected? (LLM judge with rubric).\n\nProduction signals: thumbs-up/-down feedback, citation click-through rate (low click-through suggests irrelevant cites), answer-then-refusal rate, average sources cited per answer. Alert when any metric regresses 5% week-over-week.' },
      { section: 'Observability and Cost', content: 'SLIs:\n  • p99 end-to-end latency (target <2s): broken down into embed (50ms) + ANN (30ms) + rerank (100ms) + LLM (1-1.5s).\n  • Retrieval cache hit rate (deduplicated queries).\n  • Vector DB query QPS and index freshness lag.\n  • LLM token costs per query, broken down by tenant.\n\nCost levers: cache embedded questions for 10 minutes (dedupe traffic), cache full responses for FAQs by hashing the question, use a smaller LLM by default and escalate only when the user expands a complex thread, batch embeddings during ingestion to maximise GPU utilisation.' },
    ],
    diagram: `graph TB
    subgraph Clients
        WikiSync[Wiki Sync Connector]
        SlackSync[Slack Connector]
        PDFUpload[PDF Upload]
        AskUser[Asking User]
        AdminUI[Admin Console]
    end
    subgraph Edge
        LB[Load Balancer]
    end
    subgraph Gateway
        QueryAPI[Query API]
        IngestAPI[Ingest API]
        Auth[Auth and ACL Resolver]
    end
    subgraph Services
        Parser[Document Parser Tika and BS4]
        Chunker[Semantic Chunker]
        EmbedSvc[Embedding Service Bi Encoder]
        QEmbed[Question Embedder]
        Retriever[ANN Retriever]
        MetaFilter[Metadata ACL Filter]
        Reranker[Cross Encoder Reranker]
        ContextBuilder[Context and Citation Builder]
        LLMSvc[LLM Service]
        AnswerCache[Answer Cache]
        FeedbackSvc[User Feedback Service]
    end
    subgraph Async
        Kafka[Ingestion Queue Kafka]
        EmbedWorker[Embedding Worker Pool]
        ReindexJob[Reindex on Update Job]
        EvalJob[Eval and Recall Monitor]
        DeleteJob[Tombstone Cleanup]
    end
    subgraph Storage
        VectorDB[(Vector DB HNSW)]
        DocStore[(Doc Store S3)]
        MetaDB[(Chunk Metadata DB)]
        ACLStore[(ACL Tags Store)]
        AnswerKV[(Answer Cache Redis)]
        FeedbackDB[(Feedback DB)]
    end
    subgraph Analytics
        EventBus[Query Telemetry]
        Lake[(Data Lake)]
    end

    WikiSync --> IngestAPI
    SlackSync --> IngestAPI
    PDFUpload --> IngestAPI
    AdminUI --> IngestAPI
    IngestAPI --> Auth
    IngestAPI --> Kafka --> Parser --> Chunker --> EmbedWorker --> EmbedSvc
    EmbedSvc --> VectorDB
    Parser --> DocStore
    Chunker --> MetaDB
    IngestAPI --> ACLStore

    AskUser -->|question| LB --> QueryAPI --> Auth
    QueryAPI --> AnswerCache --> AnswerKV
    AnswerCache -->|miss| QEmbed --> EmbedSvc
    QEmbed --> Retriever --> VectorDB
    Retriever --> MetaFilter --> ACLStore
    Retriever -->|top 50| Reranker
    Reranker -->|top 5| ContextBuilder --> DocStore
    ContextBuilder --> LLMSvc
    LLMSvc -->|answer plus citations| QueryAPI
    QueryAPI --> AskUser

    AskUser -->|thumbs up or down| FeedbackSvc --> FeedbackDB
    FeedbackDB --> EvalJob
    ReindexJob --> Kafka
    DeleteJob --> VectorDB

    QueryAPI --> EventBus --> Lake

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class VectorDB,DocStore,MetaDB,ACLStore,AnswerKV,FeedbackDB storage
    class Kafka,EmbedWorker,ReindexJob,EvalJob,DeleteJob async
    class LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Bi-encoder ANN vs cross-encoder for retrieval', rationale: 'Bi-encoders pre-compute one vector per chunk and serve millions of comparisons per second via ANN — but the score is a coarse proxy for relevance. Cross-encoders read (query, chunk) jointly and produce far better rankings, at the cost of one model invocation per pair — impossible on 10M chunks. The pipeline pattern (ANN narrows to 50, cross-encoder ranks 50 to 5) is the standard answer.' },
      { decision: 'Small high-precision chunks vs large high-recall chunks', rationale: 'Smaller chunks (128 tokens) score better in retrieval because the relevance signal is concentrated, but cut off context the LLM needs to actually answer. Larger chunks (1024 tokens) preserve context but dilute retrieval scores. The parent document retriever pattern — index small, return large — captures both benefits at the cost of additional metadata management.' },
      { decision: 'Hybrid (vector + BM25) vs pure vector', rationale: 'Pure vector search underperforms on exact-match queries (IDs, error codes, named entities). Adding BM25 and fusing with RRF lifts recall@50 by 5-15 points on enterprise corpora at the cost of operating two indices. Most production deployments choose hybrid; pure vector is acceptable only for conversational-only domains where keyword precision does not matter.' },
      { decision: 'Self-hosted embeddings vs API embeddings', rationale: 'API embeddings (OpenAI, Cohere) are higher quality on most benchmarks and have zero operational cost. Self-hosted embeddings (BGE, GTE) eliminate per-call cost — significant for 100M+ ingestion volumes — and remove the external dependency. The break-even is around 50M chunks ingested per month at $0.13 per million tokens. Most teams start with API and migrate when costs justify it.' },
      { decision: 'Strict refusal vs best-effort answers', rationale: 'A strict-refusal system ("only answer if cited sources cover the question") avoids hallucinations but frustrates users when retrieval misses a marginal source. A best-effort system answers more questions but introduces hallucination risk. For regulated domains (legal, medical, internal compliance) strict refusal is correct; for consumer product Q&A best-effort with caveats is usually preferred.' },
    ],
    keyTakeaways: [
      'Chunking strategy and embedding choice set the retrieval ceiling — fix them first, then optimise the rest',
      'Two-stage retrieval (ANN to 50, cross-encoder to 5) is the standard production pattern; pure ANN is insufficient for high-stakes answers',
      'Hybrid vector + BM25 with Reciprocal Rank Fusion beats either alone on enterprise corpora and is cheap to add',
      'Access control belongs in the retrieval filter, not the LLM prompt — never rely on the model to "not cite" inaccessible documents',
      'Citation extraction + grounding verification turns a fluent LLM into a defensible knowledge system; skip them and you ship hallucinations at scale',
      'Continuous evaluation against a curated golden set is the only way to catch silent quality regressions when models or content change',
    ],
    faqs: [
      { question: 'Why not just feed the whole document corpus into the LLM context?', answer: 'Even with 1M-token context windows, the latency and cost scale with input tokens — a 1M-token prompt is several seconds and dollars per query, vs sub-2s and cents for RAG. More importantly, models exhibit "lost in the middle" behaviour: attention degrades on long contexts, so the relevant passage buried at token 700K is often ignored. RAG\'s job is to pre-select the 1-5% of corpus content that actually answers the question, which both improves answer quality and reduces cost by 100x+.' },
      { question: 'How do you choose chunk size?', answer: 'Start at ~500 tokens with 50-token overlap as a baseline and measure retrieval recall on your golden set. Tune from there. The signal you watch: small chunks improve top-1 precision (relevant chunk ranks higher) but the LLM may not have enough context to answer; large chunks help context but dilute the score signal. The parent-document retriever pattern — index small (128) and serve large (512+) to the LLM — sidesteps the trade-off and is the default for production systems on heterogeneous corpora.' },
      { question: 'What is the right embedding model?', answer: 'Decide between cost, latency, and quality. OpenAI text-embedding-3-large is the strongest general-purpose API option (3072 dims). Cohere embed-v3 is competitive and multilingual. For self-hosting at scale, BGE-large or GTE-large are open-source SOTA at much lower per-call cost. Critically, the choice locks in the index — vectors from different models are incompatible, and migrating means re-embedding the whole corpus. So pilot 2-3 candidates against your golden set on a few thousand chunks before committing. Matryoshka models give you dimensionality flexibility post-hoc.' },
      { question: 'How do you stop the LLM from hallucinating when the retrieved context is bad?', answer: 'Three layers. (1) Instruct the model in the system prompt to refuse if the sources do not cover the question — modern models comply most of the time. (2) Require inline citations and reject responses that lack them via a regex check. (3) Run a grounding verifier: for each sentence in the answer, check that an NLI model or a smaller LLM judge confirms it is entailed by at least one cited source. Sentences that fail verification are flagged or rewritten. For high-stakes domains, refuse the whole answer if grounding fails. The combined effect drops hallucination rates well below 5% on benchmark sets.' },
      { question: 'How does access control work given that vectors leak semantic information?', answer: 'Two principles. (1) Apply ACL filters during ANN search — never after. A document the user cannot see should never appear as a candidate because even returning "we found 3 results but cannot show them" leaks the existence of restricted documents. (2) Store ACL tags as first-class metadata on every chunk and use filtered HNSW traversal in the vector DB (Pinecone, Qdrant, pgvector all support this). When source ACLs change, propagate to chunks within minutes via event-driven updates — a nightly batch is a multi-hour leakage window.' },
      { question: 'What is Reciprocal Rank Fusion and why do you use it?', answer: 'RRF combines results from multiple retrievers (typically dense vector + sparse BM25) without needing to calibrate their scores. For each document d: score(d) = sum over retrievers i of 1/(k + rank_i(d)), with k≈60. Documents ranked highly by multiple retrievers float to the top; the constant k damps the tail. RRF is simple, robust, has one tunable parameter, and consistently beats weighted-score combinations because it does not require score normalisation across heterogeneous retrievers. The recall@50 lift over either retriever alone is typically 5-15 points on enterprise corpora.' },
      { question: 'When do you need a re-ranker vs going straight to the LLM?', answer: 'Always for retrieval over more than a few thousand documents. ANN cosine similarity is a coarse proxy for relevance and ranks irrelevant-but-similar chunks above relevant-but-dissimilar ones (think synonyms, paraphrases, code vs prose). A cross-encoder reads (query, chunk) jointly and is much better at separating wheat from chaff. It costs ~50-100ms for top-50 candidates. The lift in answer quality is large enough that "skip the re-ranker to save 100ms" is almost always a false economy.' },
      { question: 'How do you handle a 1000-page PDF that should be one logical "document"?', answer: 'Treat structure as first-class. Parse the PDF into a hierarchical structure (book → chapter → section → paragraph) using either embedded TOC or layout-aware models (LayoutLM, Unstructured.io). Chunk at the paragraph or sub-section level but include the hierarchy as metadata (chapter_title, section_title) — this lets the LLM cite "Chapter 7, Section 3" and lets the retriever boost chunks whose hierarchy matches structural cues in the query. For very long context the LLM also benefits from a small "global summary" passage attached to each chunk so it knows where in the document the chunk sits.' },
      { question: 'What do you do when an answer needs multiple documents?', answer: 'This is the multi-hop case. Single-pass retrieval often misses it because the question phrasing matches one document but the answer needs another. Two patterns: (1) HyDE (Hypothetical Document Embeddings) — generate a draft answer first, embed that, and retrieve against it; the draft contains terms from the answer space and pulls in supporting docs. (2) Agentic / iterative retrieval — let the LLM issue follow-up queries based on what it has read, retrieve more, then answer. Iterative retrieval is more expensive but handles complex synthesis questions much better.' },
      { question: 'How do you evaluate a RAG system in production?', answer: 'A curated golden set of (question, expected_answer, expected_sources) — 100-1000 triples maintained by domain experts. Run nightly with three metrics: retrieval recall@K (did we retrieve a sufficient source?), faithfulness (is the answer supported by cited sources, via NLI or LLM judge?), and correctness (does the answer match the expected, via LLM judge with rubric?). Live signals — thumbs feedback, citation click-through, answer-followed-by-refusal rate — give continuous health monitoring. Alert when any metric regresses >5% week-over-week. Without continuous eval, you ship quality regressions silently every time you change the model, index, or chunking strategy.' },
    ],
  },
  {
    id: 33,
    slug: 'design-ml-feature-store',
    title: 'Design an ML Feature Store',
    difficulty: 'Medium',
    category: 'AI & Machine Learning',
    tags: ['feature-store', 'ml', 'online-store', 'offline-store', 'point-in-time', 'data-pipeline'],
    problemStatement: `Design a feature store that centralises the computation and serving of ML features. Data scientists define features once; the platform backfills historical values for training and serves fresh values at low latency for online inference. Target: 500 feature definitions, 10M entities (users/items), online feature reads < 10ms P99.`,
    requirements: {
      functional: ['Define features from batch (data warehouse) and streaming (Kafka) sources', 'Backfill historical feature values for model training', 'Serve online features at low latency for inference', 'Point-in-time correct joins for training data generation', 'Feature versioning and lineage tracking'],
      nonFunctional: ['Online read latency < 10ms P99', 'Training data generation within hours of a job request', 'Feature freshness < 5 minutes for streaming features', '99.9% online store availability'],
    },
    capacityEstimates: `Entities: 10M users × 500 features × 8B avg = 40 GB in online store\nOnline reads: 50K rps (inference calls) → Redis handles comfortably\nOffline store: 10M entities × 500 features × 365 days = petabyte-scale in a columnar store\nStreaming: 100K events/sec → Flink computes and writes to online store`,
    solutionBreakdown: [
      { section: 'Python SDK and Feature Definitions', content: 'Data scientists declare features in Python that gets versioned in git:\n\n  @feature_view(entities=[user], ttl=timedelta(days=30), online=True)\n  def user_purchase_features(source=BigQuerySource("transactions")):\n      return source.aggregate(\n          field="amount",\n          functions=["sum", "count", "avg"],\n          windows=[timedelta(days=1), timedelta(days=7), timedelta(days=30)],\n          group_by=["user_id"],\n      )\n\nThe SDK compiles this to (a) registry metadata stored in PostgreSQL, (b) a batch job spec for the offline materialisation, and (c) a streaming pipeline spec if online=True and source is a Kafka topic. CI runs a feature-store apply against staging; promotion to prod goes through code review and an approval gate.' },
      { section: 'Feature Registry', content: 'The registry is the single source of truth for feature metadata:\n  feature(name, entity, dtype, source, transformation_hash, owner_team, tags, created_at, deprecated_at)\n  feature_view(name, features[], ttl, online_enabled, freshness_sla, last_materialised_at)\n  entity(name, key_columns, description)\n\nIt powers: the data catalogue UI for discovery, lineage graphs (which models use this feature, which sources feed it), governance (PII tagging, retention policies), and the "request feature" workflow when a data scientist needs something new. The transformation_hash is a content hash of the Python definition — any change creates a new version of the feature, never silently overwrites.' },
      { section: 'Offline Store for Training Data', content: 'The offline store holds the full history of every feature, partitioned by entity and event_time. Backed by Parquet on S3 (or Iceberg / Delta Lake tables on top) for cheap petabyte-scale storage, queryable from Spark/Trino/Athena.\n\nSchema per feature view:\n  user_id (STRING), event_time (TIMESTAMP), feature_a (DOUBLE), feature_b (DOUBLE), ..., created_at (TIMESTAMP)\n\nevent_time is when the feature value became true in the world; created_at is when we computed it. Both matter for point-in-time correctness. Storage is partitioned by date(event_time) for efficient time-range pruning at query time.' },
      { section: 'Point-in-Time Correct Joins', content: 'The most subtle and important responsibility of a feature store. For each training row (entity_id, label_timestamp), we need feature values as of label_timestamp — not later. Otherwise the model trains on the future and inference will silently underperform.\n\nThe canonical query: for each (user_id, label_ts) in the training spine, find the feature row with event_time ≤ label_ts and event_time ≥ label_ts - ttl, joining the latest valid row. This is an ASOF JOIN in modern engines:\n\n  SELECT spine.*, f.feature_a, f.feature_b\n  FROM spine ASOF LEFT JOIN user_features f\n  ON spine.user_id = f.user_id AND spine.label_ts >= f.event_time\n  WHERE f.event_time >= spine.label_ts - INTERVAL "30 days"\n\nThe SDK generates this query automatically given the user\'s spine and a list of feature views. Without it, every data scientist reinvents this and most of them get it wrong — that is exactly how label leakage happens.' },
      { section: 'Online Store for Inference', content: 'A low-latency KV store (Redis is the default; DynamoDB and Aerospike for very large scale) holds the latest value per entity for online-enabled features:\n  HSET user:42 feature_view:user_purchase_features:purchase_count_7d 18\n                feature_view:user_purchase_features:purchase_sum_30d 421.50\n\nAt inference time the SDK issues a single HGETALL or HMGET — one round-trip, sub-millisecond if Redis is co-located. Multi-entity batches (recommend 50 products to one user) use Redis pipelining: ~1ms for 50 lookups.\n\nSerialisation: MessagePack or Protocol Buffers; never plain strings for floats. TTL per feature view (a few days) means the store self-cleans for stale entities, and the materialisation job refreshes hot entities on every batch.' },
      { section: 'Batch Materialisation', content: 'For features derived from the warehouse, a scheduled Spark job runs daily (or hourly for fresher features):\n  1. Read the source table for the materialisation window.\n  2. Apply the transformation (the same Python that data scientists wrote — executed via PySpark or compiled SQL).\n  3. Write to the offline store (Parquet, partitioned by event_time).\n  4. Compute the latest value per entity and dual-write to the online store.\n\nBackfills: when a new feature is defined, a one-off Spark job reads months of history and populates the offline store. Online store is then warmed from the latest snapshot. The same transformation code, same partitioning — backfill and incremental are not separate codebases.' },
      { section: 'Streaming Materialisation', content: 'For freshness SLAs under one hour (e.g. "user clicks in the last 5 minutes"), a Flink job consumes the source Kafka topic, applies windowed aggregations, and writes to the online store directly. Same transformation function as the batch path; the Flink runner just dispatches it differently.\n\nLate-arriving events: Flink\'s watermarks + allowed_lateness allow corrections, but corrections are expensive (they re-emit the window). Most production systems accept a small inaccuracy in exchange for simpler operations.\n\nFor exactly-once: Flink uses Kafka transactional offsets + idempotent Redis writes (HSET on a specific field). The pipeline can be replayed without double-counting if the Redis write key is deterministic.' },
      { section: 'Avoiding Training-Serving Skew', content: 'The single biggest cause of "the model worked great in training, why is production performance worse?" is training-serving skew — features computed differently online vs offline.\n\nFour skew sources to design out:\n  1. Code skew: training uses Spark UDF X, serving uses Python function Y. Fix: single transformation library imported by both pipelines, validated by a shared unit test.\n  2. Schema skew: float in training, double in serving. Fix: protobuf-typed feature definitions enforced at write time.\n  3. Data drift: source distribution changes (e.g. a new product category emerges). Fix: monitor feature distributions in prod vs training, alert on PSI > 0.2.\n  4. Time skew: training used feature_value(t+ε), serving sees feature_value(t-δ). Fix: point-in-time joins in training, freshness SLAs enforced in serving.\n\nA mature feature store removes (1) and (2) by construction; (3) and (4) are caught by monitoring.' },
      { section: 'Storage and Sharding', content: 'Offline: Parquet on S3 with Iceberg or Delta Lake metadata layers for schema evolution and time-travel queries. Partitioned by date(event_time) and clustered by entity_id hash for query efficiency. Petabyte-scale is normal.\n\nOnline: Redis Cluster, sharded by entity_id. Each shard holds ~20-50M entities. Replicas for HA. For very large entity sets (1B+ users) we move to a tiered store: hot entities (active in last 30 days) in Redis, cold entities in DynamoDB. The SDK reads Redis first and falls back to DynamoDB on miss; a daily job promotes/demotes between tiers.' },
      { section: 'Feature Logging and Drift Monitoring', content: 'Every online feature read is logged (asynchronously, sampled) with the served value, model_id, and inference timestamp. This log feeds two things:\n  1. Drift monitoring: compare the distribution of each feature in production against its training distribution using PSI (Population Stability Index) or KS-test. Alert when PSI > 0.2 (significant drift).\n  2. Online-offline parity check: for the same (entity, timestamp) pair, the online value and the offline-computed value should match. If they diverge for >0.1% of records, the materialisation pipelines have drifted.\n\nWithout these, models silently degrade as the world changes around them.' },
      { section: 'Access Control and Governance', content: 'Features can contain sensitive data (financial balances, PII). Governance baked into the registry:\n  • PII tagging on features, enforced at read time — only services with the right role can request a PII-tagged feature.\n  • Audit logs of every online feature read (sampled) for compliance.\n  • Retention policies per feature view (e.g. 90-day TTL on offline data for GDPR-sensitive features).\n  • Deprecation workflow: feature owner marks deprecated → 30-day notice email to consumers → automatic refusal after the deadline.\n\nThis is the difference between "we have a feature store" and "we have governed ML infrastructure."' },
      { section: 'Observability and SLOs', content: 'Critical SLIs:\n  • Online read p99 latency per feature view (target <10ms).\n  • Materialisation freshness: minutes since last batch write per feature view.\n  • Streaming pipeline lag (Kafka consumer lag in seconds).\n  • Online-offline parity rate (target >99.9%).\n  • Drift PSI per feature, exposed on a dashboard.\n  • Per-model feature read QPS (cost attribution).\n\nAlerts: any feature view past its freshness SLA, online read p99 > 10ms for 5 minutes, online-offline drift > 0.1%, parity violation rate > 0.5%, or a feature view backing a production model is deprecated.' },
    ],
    diagram: `graph TB
    subgraph Clients
        DataSci[Data Scientist]
        TrainingPipeline[Model Training Pipeline]
        InferenceSvc[Online Inference Service]
        DataCatalog[Data Catalog UI]
    end
    subgraph Gateway
        SDK[Feature Store SDK]
        RegistryAPI[Feature Registry API]
    end
    subgraph Services
        Registry[Feature Registry]
        TransformLib[Shared Transformation Library]
        OfflineSvc[Offline Materialization Svc]
        OnlineSvc[Online Read Service]
        StreamSvc[Streaming Materialization Svc]
        PITJoiner[Point in Time Join Engine]
        Lineage[Feature Lineage Tracker]
        ServeBatcher[HGETALL Pipeline Batcher]
    end
    subgraph Async
        SparkBatch[Spark Batch Job]
        FlinkStream[Flink Streaming Job]
        Backfill[Backfill Job]
        FreshnessMon[Feature Freshness Monitor]
        SkewDetector[Training Serving Skew Detector]
    end
    subgraph Storage
        DW[(Data Warehouse Snowflake)]
        OfflineStore[(Offline Store S3 Parquet)]
        OnlineStore[(Online Store Redis)]
        MetaDB[(Registry Metadata DB)]
        LineageDB[(Lineage DB)]
    end
    subgraph Analytics
        Kafka[Kafka Event Streams]
        EventBus[Feature Telemetry]
        Dash[Monitoring Dashboards]
    end

    DataSci -->|declare feature group| SDK --> RegistryAPI --> Registry --> MetaDB
    Registry --> Lineage --> LineageDB

    DW --> SparkBatch --> OfflineStore
    SparkBatch --> TransformLib
    SparkBatch --> OnlineStore
    Kafka --> FlinkStream --> OnlineStore
    FlinkStream --> TransformLib

    TrainingPipeline -->|get historical features| SDK --> PITJoiner --> OfflineStore
    PITJoiner --> TrainingPipeline

    InferenceSvc -->|get online features| SDK --> ServeBatcher --> OnlineSvc --> OnlineStore

    DataCatalog --> Registry
    DataCatalog --> Lineage

    Backfill --> OfflineStore
    Backfill --> OnlineStore
    FreshnessMon --> OnlineStore
    SkewDetector --> OfflineStore
    SkewDetector --> OnlineStore

    OnlineSvc --> EventBus --> Dash
    FreshnessMon --> EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class DW,OfflineStore,OnlineStore,MetaDB,LineageDB storage
    class SparkBatch,FlinkStream,Backfill,FreshnessMon,SkewDetector async
    class Kafka,EventBus,Dash analytics`,
    tradeoffs: [
      { decision: 'Separate online and offline stores vs a unified store', rationale: 'A single store (e.g. DynamoDB or Cassandra for both training and serving) avoids dual-write complexity, but no single technology serves petabyte-scale historical scans AND sub-10ms point reads cost-effectively. The split (S3+Parquet offline, Redis online) is the industry default (Feast, Tecton, Hopsworks). The cost is materialisation pipelines that must keep the two in sync — the parity check and shared transformation library exist to manage that risk.' },
      { decision: 'Push materialisation vs pull-on-demand for online features', rationale: 'Push (pre-compute and write to Redis on every batch/streaming update) gives sub-10ms reads but adds a materialisation pipeline that can lag or fail. Pull (compute features on demand from the source) is operationally simpler but seconds-to-minutes too slow for online inference. Push is the only viable option for online serving; pull is fine for ad-hoc analysis.' },
      { decision: 'Streaming materialisation vs micro-batch for fresh features', rationale: 'True streaming (Flink) gives second-level freshness but is operationally complex (state management, exactly-once semantics, watermark tuning). Micro-batch (1-minute Spark jobs) is much simpler and sufficient for most "fresh" features (minutes-old). Choose streaming only when the freshness SLA is under a few minutes — typical for fraud and abuse models, rarely for recommendations.' },
      { decision: 'Embed feature transformations in the feature store vs in the model', rationale: 'Putting transformations in the feature store enforces a single source of truth — no skew, every consumer gets the same value. Putting transformations in the model gives data scientists full flexibility but reintroduces the skew problem. Production teams converge on the feature-store-owned transformation library because the skew bugs are too expensive to allow.' },
    ],
    keyTakeaways: [
      'Point-in-time correct joins are the feature store\'s most important responsibility — they prevent the label leakage that quietly destroys model quality',
      'A shared transformation library between batch and streaming pipelines eliminates the worst class of training-serving skew bugs',
      'The online/offline split is the architectural backbone — no single technology serves petabyte training scans and 10ms point reads economically',
      'Drift monitoring (PSI on feature distributions) is the early-warning system for silent model degradation as the world changes',
      'Feature definitions are code: versioned in git, content-hashed, governed by code review — never ad-hoc SQL in a notebook',
      'Online-offline parity checks turn "we built a feature store" into "the feature store actually works" — without them, skew creeps in undetected',
    ],
    faqs: [
      { question: 'What is point-in-time correctness and why does it matter?', answer: 'When you build a training dataset, you need each row\'s feature values to reflect only what was knowable at the label timestamp. If a feature was updated at time T+1 hour and you join it to a label from time T, the model learns from the future and will silently underperform in production. Point-in-time correctness means the feature store performs ASOF joins — find the latest feature row with event_time ≤ label_ts — automatically. Without this, every data scientist would reinvent it and most would get it subtly wrong. The leakage often only shows up in production performance regression weeks later.' },
      { question: 'How does the feature store prevent training-serving skew?', answer: 'Four discipline points. (1) One transformation library, used by both batch (Spark) and streaming (Flink) pipelines — no duplicate implementations. (2) Typed feature definitions (protobuf or Avro schemas) enforced on write to both stores. (3) Online-offline parity checks: sample online reads, recompute from offline, alert on divergence > 0.1%. (4) Production feature distributions logged and compared to training distributions via PSI. Skew that survives these four checks is rare. Skew that survives without any of them is the rule.' },
      { question: 'Why separate online and offline stores instead of using one?', answer: 'Because the access patterns are incompatible. Training reads petabytes of historical data over months of event time — a workload that wants columnar storage on cheap object storage with batch query engines (Spark, Trino). Inference reads one row per entity in single-digit milliseconds — a workload that wants an in-memory KV store. No single technology serves both well at cost. Most managed stores (DynamoDB, Cassandra) can technically do both but at 10-100x the storage cost of S3+Parquet for the offline path. The dual-store pattern, with materialisation pipelines keeping them aligned, is the well-trodden answer.' },
      { question: 'What does the online store actually look like for a typical entity?', answer: 'For a user with 100 features across 10 feature views, the Redis representation is one hash per user (key user:42) with feature view name + feature name as the field, value MessagePack-encoded. HGETALL user:42 returns all 100 features in one round-trip in ~1ms. TTL is set per feature view (typically a few days) so inactive users self-evict. Multi-entity requests (rank 50 products for this user) use Redis pipelining to fetch all 50 product hashes in one round-trip, total latency ~2-3ms. Memory cost: ~10KB per active entity × 50M actives = 500GB across the Redis cluster.' },
      { question: 'How do you handle a feature definition change?', answer: 'Feature definitions are content-hashed and versioned, not edited in place. When a data scientist changes a transformation: (1) the SDK detects the changed hash and registers it as a new feature version, e.g. user_purchase_count_v3; (2) a backfill job re-materialises the new version into both stores; (3) consumers (models) explicitly opt in to the new version when they retrain. The old version stays available until all consumers migrate. Hot-swapping a feature behind a stable name silently changes every model in production — a recipe for disaster.' },
      { question: 'How fresh can streaming features actually be?', answer: 'For Flink reading from Kafka with windowed aggregations and writing to Redis: end-to-end p99 of 30 seconds is realistic. The bottleneck is usually the window emission cadence (we emit windows every N seconds) and Kafka consumer lag. For sub-second freshness (true real-time scoring), you generally bypass the feature store and compute on the fly — but then you lose the consistency guarantees the store gives you. Production fraud models usually accept 1-5 minute streaming freshness for most features and on-demand computation for the most time-sensitive ones (last transaction velocity).' },
      { question: 'What is PSI and how do you use it to detect drift?', answer: 'PSI (Population Stability Index) quantifies how much a distribution has shifted between a reference (training) and a comparison (production) period. For each bin in the feature\'s histogram: PSI = sum((p_prod - p_train) * ln(p_prod / p_train)). Rule of thumb: PSI < 0.1 is stable, 0.1-0.25 is moderate drift, > 0.25 is significant. The feature store logs production reads, computes PSI per feature daily against the training distribution, and alerts when any feature crosses 0.2. Investigate before the model accuracy regresses — drift is an early signal of upstream data changes or world changes.' },
      { question: 'How do you backfill a new feature for historical training data?', answer: 'Write a one-off Spark job that reads the source table over the desired historical window, applies the (same) transformation, and writes the result partitioned by event_time to the offline store. For a feature spanning two years of history at 100M entities and daily granularity, this is ~70B rows — Spark on 100 cores handles it in hours. After the offline backfill, snapshot the latest value per entity into the online store. Critical: use the same transformation code as the production pipeline (the shared library) — if your backfill silently differs, the training data does not represent what serving will see.' },
      { question: 'How does the feature store interact with the model registry?', answer: 'The model registry records which feature views (and which versions) each model depends on. At deployment, the model service binds to those exact feature view names+versions; if a feature is deprecated or its schema breaks, deployment fails fast. The reverse is also true: the feature store knows which models consume each feature, so deprecating a feature triggers notifications to all dependent model owners. This bidirectional lineage is the foundation of "I can change this feature without breaking production" governance.' },
      { question: 'When is a feature store overkill?', answer: 'When you have one model in production, one data scientist, and you can recompute features in a single SQL query at inference time. The feature store is overhead for scale-zero ML; its value compounds with: (1) more models reusing features (each new model is faster to build), (2) more data scientists (consistent definitions, shared knowledge), (3) tight freshness SLAs (streaming materialisation), (4) compliance requirements (governance and lineage). For a team of one shipping a single batch-scored model, a well-organised feature SQL repo is enough. For five teams shipping ten online-scored models, you need the store.' },
    ],
  },
  {
    id: 34,
    slug: 'design-ml-training-platform',
    title: 'Design an ML Training Platform',
    difficulty: 'Hard',
    category: 'AI & Machine Learning',
    tags: ['distributed-training', 'gpu-scheduling', 'experiment-tracking', 'model-registry', 'mlops'],
    problemStatement: `Design an internal ML training platform (like AWS SageMaker Training or Kubeflow) that lets data scientists submit training jobs, tracks experiments, manages datasets and model artefacts, and provisions GPU clusters on demand. Target: 500 data scientists, 1000 training jobs/day, from small CPU jobs to 512-GPU distributed runs.`,
    requirements: {
      functional: ['Submit training jobs with arbitrary code, dependencies, and hardware requirements', 'Distributed training across multiple GPUs/nodes', 'Experiment tracking (hyperparameters, metrics, artefacts)', 'Dataset versioning and lineage', 'Model registry with versioning and stage promotion (staging → production)'],
      nonFunctional: ['GPU utilisation across the cluster > 60%', 'Job scheduling latency < 60s for standard jobs', 'Artefact storage durable to 11 nines', 'Support heterogeneous hardware (A100s, H100s, CPUs)'],
    },
    capacityEstimates: `Jobs: 1000/day ≈ 0.7 jobs/sec submitted\nGPU fleet: 1000 A100s total\nArtefacts: avg 5 GB/job × 1000 jobs/day = 5 TB/day stored in S3\nMetrics: 1000 jobs × 1000 metric points = 1M data points/day — trivial for a time-series store`,
    solutionBreakdown: [
      { section: 'Job Submission API', content: 'Data scientists submit jobs via CLI / Python SDK / web UI:\n\n  platform submit \\\n    --image registry.internal/team-rec/train:abc123 \\\n    --command "python train.py --config conf/large.yaml" \\\n    --gpus 8 --gpu-type h100 --memory 256Gi --cpus 64 \\\n    --dataset s3://datasets/clicks/v42 \\\n    --priority normal --max-runtime 24h\n\nThe CLI calls POST /jobs with the spec. The Job API validates the spec (image exists, dataset accessible, quota available), assigns a job_id, persists the spec in PostgreSQL, and pushes the job to the scheduler queue. The user gets the job_id and a tail of logs streamed via SSE for the interactive case.' },
      { section: 'Container Image and Reproducibility', content: 'Every job runs in a container — the user supplies the image or uses a managed base image (pytorch:2.3-cuda12-h100). Reproducibility hinges on:\n  • The image digest (sha256, not the mutable tag) recorded in the run metadata.\n  • Pinned Python deps via uv.lock or poetry.lock baked into the image.\n  • Source code: training repo cloned into the image at a specific git commit, hash recorded.\n  • Dataset URI: versioned (DVC, LakeFS, or a versioned S3 prefix). Mutable "latest" pointers banned.\n  • Random seeds: required in the config, surfaced in run metadata.\n\nThe goal: any run can be re-created bit-exact six months later from the metadata alone. Audit trails for regulated models demand this; reproducing a training-time bug needs it too.' },
      { section: 'Gang Scheduling on Kubernetes', content: 'A 64-GPU training job needs all 64 GPUs scheduled simultaneously — getting 60 and waiting for 4 means the 60 sit idle (still billed). Best-effort Kubernetes scheduling deadlocks under high cluster utilisation.\n\nGang scheduling (Volcano, Kueue, or Yunikorn) treats a job as an indivisible unit: either all N pods are admitted or none are. Pods are placed atomically. Combined with priority and preemption: a high-priority research job evicts a lower-priority batch job to free its slots. The preempted job\'s checkpoint persists, and it requeues from the front of its priority class.\n\nTopology-aware placement: prefer pods on the same NVLink-connected node, then the same rack, then the same data centre — communication latency dominates training time for distributed jobs.' },
      { section: 'Distributed Training Frameworks', content: 'The platform doesn\'t prescribe a framework but provides the plumbing every framework needs:\n  • MASTER_ADDR / MASTER_PORT / WORLD_SIZE / RANK / LOCAL_RANK injected into each pod via env vars.\n  • An NCCL-tuned environment (NCCL_IB_DISABLE=0, NCCL_DEBUG=WARN, NCCL_SOCKET_IFNAME set to the InfiniBand interface).\n  • A pre-flight nccl-tests run that fails the job fast if interconnect bandwidth is below expectation (catches bad NICs).\n\nUsers pick:\n  • DDP (Data Parallel): each GPU has a full model copy, gradients all-reduced after backward. Standard up to ~7B params on H100.\n  • FSDP/ZeRO: shards optimiser state, gradients, and parameters across GPUs. Standard for 13B-70B.\n  • Tensor + Pipeline (Megatron-LM, DeepSpeed) for 100B+.\n  • Sequence parallel for very long contexts.\n\nMost users start with FSDP via PyTorch — works for 99% of cases.' },
      { section: 'Experiment Tracking', content: 'Inside training, three lines:\n  mlflow.start_run(experiment="rec-v3")\n  mlflow.log_params({"lr": 1e-4, "batch": 256, ...})\n  mlflow.log_metric("val_loss", loss, step=step)\n\nThe SDK buffers events client-side and ships them to a tracking server in batches every few seconds. The tracking server writes scalar metrics to a time-series DB (PostgreSQL with a metrics table, or Prometheus-compatible store), params to a relational DB, and artefacts (plots, sample predictions, checkpoint summaries) to S3 with paths in the DB.\n\nThe UI: run lists filtered by tags, side-by-side metric charts, parameter diffing across runs, link from each run to its job logs, dataset version, and registered model. Critical for "we changed the learning rate and val_loss went up — was it the LR or something else?" debugging.' },
      { section: 'Checkpointing and Fault Tolerance', content: 'A 7-day training run on 512 GPUs is $100K+. A node failure restarting from scratch is unacceptable. The pattern:\n  1. Save a checkpoint every N steps (typically 1000) to S3. Each checkpoint includes model weights, optimiser state, scheduler state, RNG state, and the step number.\n  2. Checkpoint writing is asynchronous from the training loop: a side thread serialises and uploads while training continues. With model sharding (FSDP), each rank writes its shard separately.\n  3. On any pod restart, the entrypoint checks S3 for the latest checkpoint matching the run_id and resumes from there.\n  4. PyTorch Elastic + a checkpoint-on-SIGTERM signal handler enable spot interruptions: the pod gets ~30 seconds warning, saves a checkpoint, and exits cleanly. The job re-queues and resumes when capacity returns.\n\nDelta-checkpointing (only changed shards) reduces S3 write cost; ranked-write coordination prevents 512 GPUs from saturating S3 simultaneously.' },
      { section: 'Model Registry', content: 'After training, the user registers the best checkpoint:\n  registry.register(\n      name="recsys/click-predictor",\n      version="auto",\n      model_uri="s3://artefacts/run-12345/model",\n      run_id="run-12345",\n      metrics={"val_auc": 0.87, "train_loss": 0.31},\n      tags={"stage": "staging", "owner": "team-rec"},\n  )\n\nThe registry records: model URI, source run ID (back-pointer to code + dataset + hyperparameters), eval metrics, lifecycle stage (None → Staging → Production → Archived), and approver. The inference platform pulls model_uri by name+version+stage to deploy — never by a mutable path. Stage promotion goes through a CI pipeline that runs evaluation on a holdout and an A/B test before flipping the prod tag.' },
      { section: 'Dataset Management', content: 'Datasets must be versioned for reproducibility and auditability. Two patterns:\n  • Immutable, versioned S3 prefixes: s3://datasets/clicks/v42/. New versions are new prefixes; old prefixes never overwritten. Manifest file lists every shard with sha256.\n  • DVC / LakeFS: git-like versioning over object storage with branches and tags.\n\nThe job spec references a specific version. At job start, the spec dataset URI is pinned into the run metadata. A "what dataset did this model train on?" query is a single registry lookup — not a forensic investigation into S3 last-modified timestamps.\n\nLarge datasets cached on local NVMe per node on first read (FUSE mount over S3, or pre-staged by the scheduler) to avoid hammering S3 every epoch.' },
      { section: 'Hyperparameter Tuning and AutoML', content: 'The platform supports hyperparameter sweeps natively:\n  platform sweep --config sweep.yaml --max-trials 50 --max-parallel 8\n\nA sweep is a parent job that orchestrates child jobs, each with a different hyperparameter combination. Algorithms supported: grid, random, Bayesian (Optuna/Ax), Population-Based Training. The sweep coordinator allocates trials based on early-stopping rules: a trial whose validation loss is well below the median at step N is killed to save compute.\n\nResults stream into the experiment tracker; the sweep UI shows a parallel coordinates plot of hyperparameters vs metrics. Best trials get registered automatically.' },
      { section: 'GPU Cluster Operations', content: 'The cluster is a heterogeneous fleet: A100-40GB, A100-80GB, H100, and CPU nodes. Each node labels itself with its GPU type, memory, NVLink topology, and InfiniBand availability. Scheduler constraints route jobs to compatible hardware.\n\nUtilisation tracking: dcgm-exporter scrapes per-GPU metrics (SM utilisation, memory utilisation, power, ECC errors) into Prometheus. Dashboards show cluster-wide utilisation; alerts fire on GPUs stuck at 0% utilisation (suggests a stuck training script) or ECC errors above threshold (suggests bad hardware).\n\nNode draining: when a node needs maintenance, the platform cordons it (no new pods), sends SIGTERM to running pods so they checkpoint, then drains. Spot capacity used for low-priority jobs only — checkpoints save us when AWS reclaims them.' },
      { section: 'Cost Allocation and Quotas', content: 'GPU-hours are the unit of cost. Each job is tagged with team, project, and cost-centre at submission. A nightly job aggregates GPU-hours × hourly cost into a per-team showback report. The platform enforces quotas (max concurrent GPU-hours per team, max single-job size) at the API gateway and the scheduler.\n\nCost-efficiency dashboards: GPU utilisation per job (a job using 8 H100s at 20% utilisation is a $1K/day waste); idle time between jobs; checkpoint storage per project. Engineers see "you have 12 jobs averaging 25% GPU utilisation, profile your data loaders" rather than just a monthly bill.' },
      { section: 'Observability and Job Triage', content: 'The slowest queue in any ML org is "my job is broken, please help" tickets. Tools to short-circuit them:\n  • Live job dashboard: GPU utilisation per rank, throughput in samples/sec, gradient norms, loss curve, NCCL collective latency.\n  • Auto-diagnostics: if utilisation is < 10% for > 5 minutes, the dashboard flags the likely cause (data loader bottleneck, OOM-killed worker, network stall).\n  • Stack trace capture: on OOM or kernel error, the framework writes a full Python + CUDA backtrace to S3 and posts a link to the user.\n  • Log search: training logs streamed to a central index (Loki/CloudWatch) searchable by job_id, user, error pattern.\n\nWith these, most failures are self-serviceable; the platform team only steps in for cluster-level issues (NCCL collective hangs, hardware failures).' },
    ],
    diagram: `graph TB
    subgraph Clients
        DataSci[Data Scientist]
        CLI[CLI and SDK]
        Notebook[Jupyter Notebook]
        InferencePlatform[Inference Platform]
    end
    subgraph Gateway
        JobAPI[Job Submit API]
        Auth[Auth and Quota Service]
        UI[Web UI]
    end
    subgraph Services
        Scheduler[Gang Scheduler Volcano]
        K8sCtl[Kubernetes Control Plane]
        ResourceMgr[Resource and Quota Mgr]
        DDPLauncher[DDP and FSDP Launcher]
        NCCLBootstrap[NCCL Bootstrap]
        Tracker[Experiment Tracker MLflow]
        Registry[Model Registry]
        ElasticCtl[PyTorch Elastic Controller]
        DatasetSvc[Dataset Versioning Service]
        Promotion[Stage Promotion Service]
    end
    subgraph Async
        CheckpointJob[Periodic Checkpoint Saver]
        SpotInterrupt[Spot Preempt Handler]
        ArtifactGC[Old Artifact GC]
        MetricsAgg[Metrics Aggregator]
        BillingAgg[GPU Hours Billing]
    end
    subgraph Storage
        GPUPoolA100[GPU Pool A100]
        GPUPoolH100[GPU Pool H100]
        CPUPool[CPU Pool]
        ArtifactS3[(S3 Artifact Store)]
        CheckpointS3[(Checkpoint S3)]
        RunDB[(Run Metadata PostgreSQL)]
        ModelRegistryDB[(Model Registry DB)]
        DatasetCatalog[(Dataset Catalog)]
    end
    subgraph Analytics
        EventBus[Job Telemetry Bus]
        Dash[Grafana Dashboards]
    end

    DataSci --> CLI --> JobAPI --> Auth
    Notebook --> JobAPI
    UI --> JobAPI

    JobAPI --> ResourceMgr
    JobAPI --> Scheduler --> K8sCtl
    Scheduler --> GPUPoolA100
    Scheduler --> GPUPoolH100
    Scheduler --> CPUPool

    K8sCtl --> DDPLauncher
    DDPLauncher --> NCCLBootstrap --> GPUPoolA100
    DDPLauncher --> ElasticCtl

    GPUPoolA100 -->|metrics and params| Tracker --> RunDB
    GPUPoolA100 -->|checkpoints| CheckpointJob --> CheckpointS3
    GPUPoolA100 -->|artifacts| ArtifactS3

    GPUPoolA100 --> DatasetSvc --> DatasetCatalog

    Tracker --> Registry --> ModelRegistryDB
    Registry --> Promotion --> InferencePlatform

    SpotInterrupt --> GPUPoolA100
    SpotInterrupt --> CheckpointJob
    ArtifactGC --> ArtifactS3
    MetricsAgg --> Tracker

    GPUPoolA100 --> BillingAgg
    BillingAgg --> EventBus --> Dash

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class ArtifactS3,CheckpointS3,RunDB,ModelRegistryDB,DatasetCatalog storage
    class CheckpointJob,SpotInterrupt,ArtifactGC,MetricsAgg,BillingAgg async
    class EventBus,Dash analytics`,
    tradeoffs: [
      { decision: 'Gang scheduling vs best-effort scheduling', rationale: 'Best-effort scheduling under high cluster utilisation deadlocks distributed jobs — 60 of 64 pods allocated and waiting forever for the last 4, with all 60 burning GPU-hours idle. Gang scheduling guarantees atomic allocation; the cost is some head-of-line blocking when very large jobs queue up. Mitigate with priority queues and backfill: smaller jobs slot into gaps the large job leaves.' },
      { decision: 'DDP vs FSDP vs Tensor+Pipeline Parallel', rationale: 'DDP is simplest and has lowest communication overhead, but requires the full model in each GPU. FSDP shards optimiser state + gradients + parameters, fitting 4-10x larger models at the cost of more all-gather/reduce-scatter ops. TP+PP is for models that do not fit even sharded across a single node, but adds significant code complexity. Default to FSDP; reach for TP+PP only at 100B+ scale.' },
      { decision: 'Spot/preemptible vs on-demand GPUs', rationale: 'Spot is 60-90% cheaper but can be reclaimed with 30 seconds warning. With robust checkpointing + elastic training, spot is great for long batch training. On-demand is mandatory for interactive debugging and tight-deadline runs. Most teams run a baseline on-demand pool + a spot pool that absorbs the bursty top.' },
      { decision: 'Centralised tracking server vs per-team', rationale: 'A central tracker (one MLflow instance for the org) gives cross-team experiment discovery and a single source of truth, at the cost of being a shared dependency. Per-team trackers are simpler operationally but fragment knowledge and complicate compliance audits. Centralised wins for any org with >2 ML teams.' },
      { decision: 'Allowing arbitrary Docker images vs a curated base image set', rationale: 'Arbitrary images give data scientists full flexibility but create security risks (unscanned bases) and operational headaches (every job a unique CUDA stack). Curated bases (a handful of approved images with security scanning, NCCL tuned, common libraries pinned) cover 95% of needs with much less variance. Most platforms allow user images but strongly nudge toward curated bases via documentation and starter templates.' },
    ],
    keyTakeaways: [
      'Gang scheduling is non-negotiable for distributed training — partial allocation under load creates silent deadlocks worth tens of thousands of dollars per incident',
      'Reproducibility requires pinning the image digest, source commit, dataset version, and random seed — anything less is a forensic investigation waiting to happen',
      'Checkpointing every N steps to S3 + elastic restart is what makes spot GPU economics work and makes 7-day training runs survivable',
      'The model registry links every production model to its exact training run (code + data + hyperparameters) — the foundation of safe rollbacks and audit trails',
      'GPU utilisation is the primary cost lever: a job using 8 H100s at 30% utilisation is essentially a $300/day data-loader bug',
      'Auto-diagnostics on the job dashboard turn most "my job is broken" tickets into self-serve fixes, freeing the platform team for real issues',
    ],
    faqs: [
      { question: 'Why is gang scheduling so important?', answer: 'Distributed training jobs use synchronous collective operations (all-reduce after each backward pass). If only 60 of 64 pods are running, the 60 spin in a barrier waiting for the other 4 — burning GPU-hours, not training. Best-effort schedulers happily admit the 60 and queue the rest, creating a deadlock. Gang scheduling treats the job as an indivisible unit: all 64 pods are placed atomically, or none. Combined with priority-based preemption and topology-aware placement, it is the only viable scheduling strategy for production distributed training.' },
      { question: 'What is the difference between DDP and FSDP?', answer: 'DDP (Distributed Data Parallel) replicates the entire model on each GPU; each device processes its slice of the batch independently and then all-reduces gradients before the next optimiser step. Simple, communication-efficient, but capped by the largest model that fits in one GPU. FSDP (Fully Sharded Data Parallel) shards model parameters, gradients, and optimiser state across GPUs — at each layer, each rank gathers the shards it needs from its peers, computes, then releases them. This fits 4-10x larger models at the cost of more all-gather/reduce-scatter operations per step. FSDP\'s communication overhead is lower than it sounds with overlap; for 13B+ models it is the default. Below ~7B, plain DDP is faster.' },
      { question: 'How do you handle a node failure mid-training?', answer: 'Three layers of defence. (1) Periodic checkpoints to S3 every 1000 steps — sharded writes so 512 GPUs are not contending. (2) PyTorch Elastic detects pod failures and either restarts the failed pod (joining the existing world) or restarts the entire job from the latest checkpoint. (3) Spot interruptions get 30 seconds of warning; a signal handler triggers an emergency checkpoint, the job exits cleanly, and the scheduler re-queues it. Recovery time after a single-pod failure: minutes. Time lost: up to the checkpoint interval. The economics of a 7-day run only work because of this — restarting from scratch would burn weeks of GPU-time per failure.' },
      { question: 'What is checkpoint sharding and why does it matter?', answer: 'A 70B model in FSDP has each rank holding 1/N of the parameters. The naive checkpoint approach is to all-gather the full model to rank 0 and write — but for 70B that is 140GB, and the network/disk bottleneck blocks training for minutes. Sharded checkpoints write each rank\'s shard independently to S3, in parallel, with a manifest tying them together. Restore reverses it: each rank reads only its shard. Writes drop from minutes to seconds and scale linearly with cluster size. PyTorch\'s DCP (Distributed Checkpoint) does this; it is now the default for FSDP jobs at scale.' },
      { question: 'Why is reproducibility so hard, and what does the platform do about it?', answer: 'A training run depends on: source code, dependency versions, system libraries, hardware drivers, dataset content, dataset shuffle order, random seeds, and timing. Change any of them and results may differ. The platform addresses each: source code by recording the git SHA, deps by baking lockfiles into the image, system libs by image digest, dataset by versioned URI + manifest hash, shuffle by recording the seed and using deterministic samplers, RNG by setting seeds for Python/NumPy/PyTorch/CUDA. True bit-exact reproducibility additionally requires CUDA deterministic algorithms (slower) — most teams aim for "statistically reproducible to within validation noise" rather than bit-exact.' },
      { question: 'How does the model registry connect training to serving?', answer: 'When a training run produces a candidate, the user calls registry.register() with the model URI, source run_id, and eval metrics. The registry stores a versioned record; the inference platform pulls by (model_name, version) to deploy. Stage tags (Staging, Production) decouple "this version exists" from "this version is serving traffic." Promotion to Production goes through a CI pipeline that runs offline evaluation on a holdout, A/B tests in staging, and either auto-promotes on success or requires human approval. Rollback is trivial — flip the Production tag back to the previous version. Without this decoupling, models would be pinned to deploy artefacts and rollback would be a code change.' },
      { question: 'What metrics should the platform track to control cost?', answer: 'Two layers. (1) Per-job: GPU utilisation (SM occupancy, not just nvidia-smi util), memory utilisation, samples/sec throughput, distributed efficiency (effective FLOPS vs theoretical peak). A job at 30% utilisation is leaving 70% of its allocated compute on the floor — usually a data loader bottleneck or wrong parallelism strategy. (2) Per-team: GPU-hours consumed, idle time between jobs, checkpoint storage cost, percentage of jobs that were cancelled or failed. Showback reports give teams visibility; quota enforcement prevents runaways. Without per-job utilisation tracking, you find out about a $500K bug at month-end.' },
      { question: 'How do you support hyperparameter sweeps without DDoS-ing the cluster?', answer: 'A sweep is a parent job that orchestrates child trials. The sweep coordinator runs Bayesian optimisation (Optuna/Ax) or population-based training, allocating up to max_parallel concurrent trials. Each child is itself a job submitted through the regular scheduler, subject to team quotas. Early stopping kills trials that are clearly underperforming after N steps — typically halving compute spend on a sweep. The whole sweep counts as one logical experiment in the tracker with a parallel-coordinates UI; the best trials get registered automatically. The platform team gets to charge cost-effectively against the team\'s GPU quota rather than letting sweeps escape resource caps.' },
      { question: 'How do you handle dataset versioning at scale?', answer: 'Datasets get immutable, versioned S3 prefixes (s3://datasets/clicks/v42/) plus a manifest file listing every shard with sha256. New versions go to a new prefix; old prefixes are never modified. The job spec references a specific version; the spec is recorded in run metadata at job start. Mutable "latest" pointers are banned because they break reproducibility silently. For very large datasets we use FUSE-mounted lazy loading with per-node NVMe caching — the first epoch pays the S3 read cost, subsequent epochs hit local NVMe. DVC and LakeFS provide git-like semantics on top for teams that want branching/tagging workflows.' },
      { question: 'What is the biggest reason training jobs fail?', answer: 'Empirically, OOMs from a too-large batch size or a memory leak in the data loader are #1. #2 is silent NaN explosions from learning rates that are too high or unscaled gradients in mixed precision. #3 is NCCL collective timeouts caused by a single straggler node (often a bad InfiniBand cable or thermal throttling). #4 is dataset corruption (a shard returns a 503 from S3 and the job retries forever). The platform should detect all of these automatically: OOMs surface a clear error with the offending tensor shapes, NaN detection runs every N steps and pauses training for the user to inspect, NCCL hangs trigger a heartbeat-based failover, and dataset errors propagate clean exceptions rather than infinite retries.' },
    ],
  },
  {
    id: 35,
    slug: 'design-vector-database',
    title: 'Design a Vector Database',
    difficulty: 'Hard',
    category: 'AI & Machine Learning',
    tags: ['vector-database', 'ann', 'hnsw', 'embeddings', 'similarity-search', 'ivf'],
    problemStatement: `Design a vector database (like Pinecone, Weaviate, or Qdrant) that stores high-dimensional embedding vectors and answers approximate nearest-neighbour (ANN) queries in milliseconds. The system must support metadata filtering, real-time upserts, and horizontal scaling. Target: 1B vectors at 1536 dimensions, < 50ms P99 query latency, 99.9% availability.`,
    requirements: {
      functional: ['Upsert vectors with an ID and optional metadata payload', 'Query top-K nearest vectors to a query vector (cosine / dot-product / L2)', 'Filter by metadata predicates during search (e.g. category=finance AND date>2024)', 'Delete vectors by ID', 'Namespace/collection isolation for multi-tenancy'],
      nonFunctional: ['Query latency < 50ms P99', 'Upsert visible within 1s (near real-time index update)', '99.9% availability', '1B vectors at 1536 dims'],
    },
    capacityEstimates: `Storage: 1B × 1536 dims × 4B (float32) = 6 TB raw vectors\nWith HNSW graph overhead (~5×): ~30 TB index on disk\nIn-memory (quantised to int8): 1B × 1536B = 1.5 TB RAM across nodes\nQuery: 10K QPS × 50ms budget → need ~500 query threads across cluster`,
    solutionBreakdown: [
      { section: 'API Design', content: 'A vector DB exposes a small, focused surface:\n  POST /collections { name, dimension, metric (cosine|dot|l2), index_type } → creates a collection\n  POST /collections/{name}/vectors { id, vector[], metadata } → upsert\n  POST /collections/{name}/vectors/batch { items[] } → bulk upsert (preferred at scale)\n  POST /collections/{name}/query { vector[], top_k, filter, include_metadata } → returns [{ id, score, metadata }]\n  DELETE /collections/{name}/vectors/{id}\n  POST /collections/{name}/query/by_id { id, top_k } → "find similar to this existing vector"\n\nWrites are async — accepted into a write-ahead log, durably committed in <100ms, visible in queries within ~1 second (eventual consistency). Reads are synchronous and return within the latency budget. Collections (also called namespaces or indexes) provide tenant isolation — each is its own HNSW index with its own configuration.' },
      { section: 'HNSW Algorithm Deep Dive', content: 'HNSW (Hierarchical Navigable Small World) is a multi-layer graph: the top layer is sparse with long-range links, lower layers progressively denser with shorter links. Layer 0 contains every vector. Each upper layer contains a random subset (probability 1/e per level).\n\nConstruction: insert vectors one at a time. Each new vector is randomly assigned a maximum layer l. From the top entry point, greedy-search to find the nearest neighbour at every layer down to l; at each layer ≤ l, connect to M (typically 16-32) nearest existing vectors. Cost: O(log N) per insert.\n\nQuery: start at the top entry point. At each layer, greedy-traverse toward the query vector — pick the neighbour minimising distance and repeat until no neighbour is closer. Descend to the next layer at the resting node, repeat. At layer 0, perform a beam search of width ef_search (typically 100-500) to collect the top-K candidates. Total cost: O(log N) with high recall (95%+).\n\nKey hyperparameters: M (per-node connectivity, memory vs recall), ef_construction (build quality vs build time), ef_search (query recall vs latency).' },
      { section: 'Quantisation', content: 'Full float32 vectors at 1B × 1536 dims = 6 TB — way too much for RAM. Two compression schemes, often layered:\n\nScalar quantisation: map each float32 dimension to int8 (or int4) via per-dimension min/max scaling. 4× compression for int8, negligible recall loss (<1% with proper calibration). Now the default in Qdrant, Weaviate, and most production systems.\n\nProduct Quantisation (PQ): split each vector into M sub-vectors of length d/M, learn a 256-entry codebook per sub-vector via k-means, replace each sub-vector with its codebook index (1 byte). For d=1536 and M=96, each vector becomes 96 bytes — 64× compression vs float32. Recall cost is real (~5-15%) but acceptable for billion-scale.\n\nProduction layering: PQ-compressed vectors live in RAM and drive the HNSW graph traversal (fast approximate distances via lookup tables). The top-K candidates are re-scored using the original float32 vectors (stored on disk or in a separate hot store) for accuracy. This re-rank step recovers most of the recall loss.' },
      { section: 'Distance Metrics', content: 'Three are universal:\n  • Cosine similarity: best for normalised embedding vectors (most NLP embeddings). Equivalent to dot product on unit vectors.\n  • Dot product: when vector magnitudes carry signal (some recommendation embeddings).\n  • L2 (Euclidean): image embeddings, k-means-style centroids.\n\nThe metric is fixed at collection creation — changing it requires re-indexing. For cosine, we normalise vectors at insert time so internally we use dot product (cheaper). For L2, we store squared distance to avoid square roots in the hot path.\n\nAll metrics are implemented in SIMD (AVX-512, NEON) for ~4-8× speedup over scalar code. On modern CPUs, a single-vector cosine on 1536 dims is ~150 ns.' },
      { section: 'Metadata Filtering', content: 'Metadata is the difference between a toy and a production system. Users want "find vectors similar to X where category=finance AND date > 2024-01-01 AND user_id IN [...]". Three strategies:\n\n1. Post-filter: ANN-search, then drop results that fail the filter. Fast but if the filter is selective (matches <1% of vectors) you return <K results. Bad.\n2. Pre-filter: scan a metadata index for the filtered IDs, then brute-force or rebuild a sub-index. Accurate but slow if the filtered set is large (>10K).\n3. Filtered HNSW traversal: during graph traversal, skip neighbours whose metadata fails the filter. Works well if the filter is moderately selective and the graph is connected within the filtered subset.\n\nProduction systems route by estimated selectivity: very low selectivity (matches >50%) → post-filter; very high (matches <0.1%) → pre-filter + brute force; in between → filtered HNSW. The cost-based optimiser uses a small sample.\n\nGotcha: highly selective filters can disconnect the HNSW graph (filter eliminates the entry points) — the system needs multiple entry points or a fallback to brute force.' },
      { section: 'Distributed Architecture', content: 'Shard by collection then by vector_id hash. Each shard holds a complete HNSW index for its assigned vectors. Typical shard size: 50-100M vectors (limited by RAM for the index).\n\nQuery flow (scatter-gather):\n  1. Coordinator receives query, identifies the target collection\'s shards (e.g. 20 shards).\n  2. Fans out the query to all shards in parallel.\n  3. Each shard returns its local top-K candidates with scores.\n  4. Coordinator merges, deduplicates, sorts globally, returns the top-K.\n\nReplication factor of 3 for fault tolerance. Writes go through a primary that durably appends to the WAL, then asynchronously replicates to followers. Reads are served from any replica (load-balanced). Quorum reads available for stronger consistency at higher latency.\n\nAt the network layer, gRPC streams candidates back as they are computed; the coordinator early-terminates once it has confident top-K from enough shards. This reduces p99 latency under tail-latency conditions.' },
      { section: 'Storage and Persistence', content: 'The HNSW graph itself lives in RAM (linked-list-of-IDs structures). The vectors (float32 originals) live in mmaped files on local NVMe — the OS page cache handles hot vectors. Metadata lives in an embedded RocksDB per shard.\n\nDurability comes from a write-ahead log: every upsert appends to the WAL synchronously (group commit, fsync every 10ms) before acknowledging the client. On restart, the WAL replays into the in-memory graph and on-disk vector files.\n\nSnapshotting: nightly snapshot of the graph + vector files to S3 for disaster recovery. Recovery from a snapshot + WAL tail is faster than rebuilding the graph from scratch (which would take hours for a 100M-vector shard).' },
      { section: 'Real-time Upserts and Deletes', content: 'HNSW supports online inserts directly in O(log N). New vectors enter the graph immediately; the small inconsistency window across replicas (asynchronous replication lag ~100ms) is acceptable for most use cases.\n\nDeletes are harder. Removing a node from HNSW would require re-linking its neighbours — expensive. Standard solution: tombstones. The vector ID is marked deleted in a bitmap; the graph still contains it but the query layer skips it. After enough tombstones accumulate (>10% of the shard), an offline compaction rebuilds the graph without the deleted vectors. This takes minutes to hours for a large shard but happens in the background.\n\nFor very fresh data (writes that must be visible immediately), the SDK can route reads to include a brute-force scan of a small in-memory "dirty buffer" of the last few seconds of writes that have not yet been integrated into the main index.' },
      { section: 'Multi-tenancy', content: 'B2B vector DBs serve thousands of tenants, each needing isolation:\n  • Logical isolation: each tenant gets one or more namespaces (collections). Quotas and rate limits per namespace.\n  • Resource isolation: hot tenants on dedicated nodes, long-tail tenants colocated. Provisioned tier vs serverless tier.\n  • Security isolation: per-tenant API keys, role-based access, audit logs of every query.\n\nFor very small tenants (<10K vectors each), a "merged namespace" approach packs many tenants into one HNSW index with a tenant_id metadata filter — much cheaper than one index per tenant when overhead dominates. The trade-off is that tenant_id becomes a high-selectivity filter applied to every query.' },
      { section: 'Hybrid Search: Vector + Sparse + Filters', content: 'Pure vector search misses exact-keyword matches (product names, codes, error messages). Production systems support hybrid search: combine dense vector results with BM25-style sparse text search and metadata filters in one query.\n\nImplementation: maintain two indices per collection (HNSW for dense, inverted index for sparse text), query both, fuse with Reciprocal Rank Fusion. Some systems support SPLADE-style learned sparse vectors that combine BM25\'s exact-match strengths with learned term importance.\n\nQuery API:\n  POST /query {\n    vector: [...], sparse_vector: { "indices": [...], "values": [...] },\n    filter: { category: "finance" }, top_k: 10, alpha: 0.7\n  }\nalpha tunes the dense/sparse weighting.' },
      { section: 'Observability and SLOs', content: 'Critical SLIs per collection:\n  • Query p99 latency (target <50ms).\n  • Recall@K vs the brute-force ground truth (sampled, target ≥95%).\n  • Index freshness: seconds from upsert to query-visible.\n  • Tombstone ratio (alert when >20%, triggers compaction).\n  • Memory utilisation per shard (alert when >85% to plan resharding).\n  • Replication lag.\n\nQuery cost attribution: every query logs which shards it hit, the number of distance computations, and the time spent in each stage (graph traversal vs re-rank). This lets us identify expensive queries (typically those with extreme filters or top_k>1000) and route them differently.\n\nWe periodically run brute-force ground-truth comparisons on a small sample (1000 queries × full scan) to detect recall regression after compaction or index rebuilds.' },
      { section: 'Capacity Planning and Cost', content: 'The dominant cost is RAM (for the graph) and CPU (for distance computations).\n\nMemory model per shard with 100M vectors at 1536 dims:\n  Graph edges: 100M × 32 (M=32) × 8B (uint64 ID) = 25 GB\n  Quantised vectors (int8): 100M × 1536 × 1B = 150 GB\n  Metadata + tombstones: ~10 GB\n  Total: ~200 GB per shard → fits a single high-memory node\n\nQPS per shard: ~500-1000 single-threaded; with 32 cores, ~15-30K QPS at p99 <50ms. Scale out shards for higher throughput.\n\nCost optimisations:\n  • Quantisation (4-64× compression) is free recall after re-rank.\n  • Tiered storage: cold vectors on NVMe, hot in RAM.\n  • Serverless mode: shards page in on demand for infrequently accessed namespaces.\n  • Batched queries: clients send N queries in one request, the server runs them in parallel against the same hot pages.' },
    ],
    diagram: `graph TB
    subgraph Clients
        RAGApp[RAG Application]
        ImageSearch[Image Similarity App]
        RecSys[Recommendation System]
        AdminUI[Admin UI]
    end
    subgraph Edge
        LB[Load Balancer]
    end
    subgraph Gateway
        APIGW[Vector DB API]
        Auth[Auth and Namespace ACL]
    end
    subgraph Services
        Coordinator[Query Coordinator]
        UpsertSvc[Upsert Service]
        DeleteSvc[Delete Service]
        FilterPlanner[Filter Selectivity Planner]
        Scatter[Scatter Query Fan Out]
        Gather[Top K Merge and Rerank]
        Shard1[Shard 1 HNSW]
        Shard2[Shard 2 HNSW]
        ShardN[Shard N HNSW]
        Replica1[Shard 1 Replica]
        Replica2[Shard 2 Replica]
        ReRanker[Original Vector Reranker]
        Quantizer[PQ and Scalar Quantizer]
    end
    subgraph Async
        BuilderJob[HNSW Index Builder]
        CompactJob[Tombstone Compaction]
        TrainingJob[PQ Codebook Trainer]
        ReplLag[Replica Sync]
        DirtyBufferGC[Dirty Buffer Flush]
    end
    subgraph Storage
        VectorsRaw[(Raw float32 Vectors)]
        QuantVectors[(Quantized int8 Vectors)]
        HNSWGraph[(HNSW Graph Edges)]
        MetaIdx[(Metadata Inverted Index)]
        Tombstones[(Tombstone Log)]
        DirtyBuffer[(Dirty Upsert Buffer)]
        NamespaceMeta[(Namespace Registry)]
    end
    subgraph Analytics
        EventBus[Query Telemetry]
        Metrics[Recall and Latency Dashboards]
    end

    RAGApp -->|query top K| LB --> APIGW --> Auth
    ImageSearch --> APIGW
    RecSys --> APIGW
    AdminUI --> APIGW

    APIGW --> Coordinator
    Coordinator --> FilterPlanner --> MetaIdx
    FilterPlanner -->|low selectivity post filter| Scatter
    FilterPlanner -->|high selectivity pre filter| Scatter
    Scatter --> Shard1
    Scatter --> Shard2
    Scatter --> ShardN
    Shard1 --> HNSWGraph
    Shard1 --> QuantVectors
    Shard1 --> DirtyBuffer
    Shard1 -->|local top K| Gather
    Shard2 -->|local top K| Gather
    ShardN -->|local top K| Gather
    Gather --> ReRanker --> VectorsRaw
    ReRanker -->|global top K| APIGW --> RAGApp

    APIGW -->|upsert| UpsertSvc --> Shard1
    UpsertSvc --> VectorsRaw
    UpsertSvc --> Quantizer --> QuantVectors
    UpsertSvc --> DirtyBuffer

    APIGW -->|delete by id| DeleteSvc --> Tombstones

    Shard1 --> Replica1
    Shard2 --> Replica2
    ReplLag --> Replica1

    BuilderJob --> HNSWGraph
    CompactJob --> Tombstones
    CompactJob --> HNSWGraph
    TrainingJob --> Quantizer
    DirtyBufferGC --> DirtyBuffer

    APIGW --> NamespaceMeta
    Coordinator --> EventBus --> Metrics

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class VectorsRaw,QuantVectors,HNSWGraph,MetaIdx,Tombstones,DirtyBuffer,NamespaceMeta storage
    class BuilderJob,CompactJob,TrainingJob,ReplLag,DirtyBufferGC async
    class LB edge
    class EventBus,Metrics analytics`,
    tradeoffs: [
      { decision: 'HNSW vs IVF (Inverted File Index)', rationale: 'HNSW delivers higher recall at low latency with no training step required, but holds the graph in memory — expensive at billion scale. IVF clusters vectors into centroids via k-means (training step required), then searches only the nearest few clusters at query time — cheaper memory, shardable, but with somewhat lower recall and a need to retrain when the data distribution shifts. HNSW dominates online serving; IVF+PQ remains the choice for billion-scale offline batch search.' },
      { decision: 'Scalar quantisation vs Product Quantisation vs full float32', rationale: 'Full float32 is most accurate but costs 6 TB at 1B × 1536 — uneconomic. Int8 scalar quantisation gives 4× compression with <1% recall loss and is the default for most production systems. PQ gives 32-96× compression with 5-15% recall loss — worth it at extreme scale or for cold tiers, but requires re-rank against original vectors to recover accuracy. Layering (PQ for traversal + float32 re-rank) is the common production pattern.' },
      { decision: 'Pre-filter vs post-filter vs filtered-traversal for metadata', rationale: 'Post-filter is the simplest implementation but fails on selective filters (returns fewer than K results). Pre-filter + brute force is accurate but slow for large filtered subsets. Filtered HNSW traversal works for moderate selectivity but can disconnect the graph at extreme selectivities. Production systems use a cost-based router that estimates selectivity from a sample and picks the right strategy per query.' },
      { decision: 'Tombstone deletes vs in-place graph repair', rationale: 'In-place repair is correct but expensive — re-linking the neighbours of a deleted node touches the graph at every layer. Tombstones make deletes O(1) but bloat the index and degrade recall as the tombstone ratio grows. The standard answer is tombstone deletes + background compaction at a tombstone-ratio threshold. The cost is a periodic resource spike during compaction; the alternative is unacceptable foreground latency.' },
      { decision: 'Single index per tenant vs merged namespace', rationale: 'One HNSW index per tenant gives perfect isolation but has fixed overhead (index header, in-memory structures) that wastes resources for tiny tenants. Merged namespaces pack many small tenants into one index with tenant_id metadata filter — dramatically cheaper but forces tenant_id into a high-selectivity filter on every query. Most production systems run both: dedicated indices for large tenants, merged namespaces for the long tail.' },
    ],
    keyTakeaways: [
      'HNSW + scalar quantisation is the production default: O(log N) queries, 4× memory compression, and minimal recall loss',
      'Metadata filtering is what separates a research prototype from a production system — the routing between pre/post/filtered-traversal is the most important design decision',
      'Tombstone deletes plus background compaction is the only practical pattern for high-throughput delete workloads on HNSW',
      'Quantisation for the index + float32 re-rank for the top candidates gives the cost benefit without sacrificing final-result accuracy',
      'Scatter-gather across shards is the standard distributed pattern; the coordinator deduplicates and merges per-shard top-K into the global result',
      'Hybrid dense + sparse search (vector + BM25, fused by RRF) outperforms either alone on enterprise workloads with exact-match needs',
    ],
    faqs: [
      { question: 'Why HNSW over IVF or LSH?', answer: 'Three reasons. (1) Recall: HNSW gets 95%+ recall@10 at typical settings, vs ~80-90% for IVF and worse for LSH. (2) No training step: HNSW is incremental — insert vectors and the graph builds itself. IVF requires k-means training that must be redone when the distribution shifts. (3) Lower latency: HNSW\'s greedy graph traversal is sub-millisecond per query at million-scale; IVF\'s cluster-probing has more overhead. IVF wins on memory cost at extreme scale (billions per shard) and remains popular for batch offline search, but HNSW dominates online serving.' },
      { question: 'What does the M parameter actually do in HNSW?', answer: 'M is the maximum number of neighbour links per node per layer. Higher M means denser graph: better recall (more paths to find the true nearest neighbour) and faster convergence per query, at the cost of more memory (each node\'s edge list is bigger) and slower construction. Typical M for embedding workloads: 16-32. Memory scales linearly with M; recall improves but with diminishing returns past M=32. Going below M=8 substantially hurts recall on hard distributions.' },
      { question: 'How does HNSW achieve O(log N) at query time?', answer: 'The layered structure. Each upper layer is a sparser random subset (probability 1/e per layer) of the layer below, with long-range links. A query starts at the top layer\'s entry point, greedy-traverses toward the query vector through fewer than O(log N) hops because each step roughly halves the distance, descends to the next layer at the resting node, and repeats. At layer 0 it does a wider beam search (ef_search candidates) to pick up the actual nearest neighbours. The log-factor comes from the geometric thinning of layers; the empirical recall holds up well at hundreds of millions of vectors.' },
      { question: 'When should you use Product Quantisation vs scalar quantisation?', answer: 'Scalar quantisation (float32 → int8) is the default — 4× compression, <1% recall loss, simple to implement with SIMD. Use PQ when memory budget forces 30×+ compression: storing 1B 1536-dim vectors in <100GB RAM requires PQ. The recall cost is real (5-15% out of the box) but you recover most of it by re-ranking the top candidates against the original float32 vectors. PQ is also useful for cold tiers and offline batch jobs where extreme compression matters more than peak recall. Mixedbread-style binary quantisation (1 bit per dimension) takes this further at greater recall cost.' },
      { question: 'How is metadata filtering implemented without ruining performance?', answer: 'The system maintains a metadata inverted index (tag → set of vector_ids) alongside the HNSW graph. At query time, the planner estimates the filter\'s selectivity from a sample. For low selectivity (filter matches most vectors), do post-filter: HNSW search ignoring filter, drop non-matching results. For high selectivity (<0.1%), pre-filter: gather the matching IDs and brute-force their distances. For moderate selectivity, do a filtered traversal: HNSW search but skip non-matching neighbours during graph walk. The hard case is highly selective filters that disconnect the graph — the system needs multiple entry points and may fall back to brute force on that subset.' },
      { question: 'How do you delete a vector from HNSW?', answer: 'Tombstones. Removing a node would require re-linking its neighbours at every layer — an expensive operation that bloats latency. Instead, mark the vector\'s ID as deleted in a bitmap; graph traversal skips it. The vector continues to occupy memory and inflate the graph. When the tombstone ratio exceeds a threshold (typically 10-20%), an offline compaction rebuilds the index without the tombstoned entries. Compaction takes minutes to hours for a large shard but happens in the background while a snapshot serves queries. The trade-off is acceptable latency in steady state at the cost of periodic resource spikes during compaction.' },
      { question: 'How does multi-tenancy work without one HNSW index exploding into a thousand tiny indices?', answer: 'Two-tier strategy. Large tenants get a dedicated index (or a set of shards) — they pay the overhead and benefit from isolation. Small tenants are packed into shared "merged namespace" indices, each with a tenant_id metadata field; every query carries a tenant_id filter. The shared model amortises the per-index overhead (graph headers, in-memory structures, file handles) across thousands of small tenants. Promotion happens automatically: when a tenant\'s vector count crosses a threshold, the system rebuilds it into a dedicated index in the background and switches reads over.' },
      { question: 'How do you handle 1B vectors that do not fit on one node?', answer: 'Shard by vector_id hash across nodes. Each shard holds 50-100M vectors with its own complete HNSW index — fits in 200-400GB RAM. At query time the coordinator scatters the query to all shards, each returns its local top-K, the coordinator merges and returns the global top-K. Replication factor of 3 for fault tolerance. The hard part is keeping the index distribution balanced: skewed insert keys produce hot shards. Periodically rebalance by migrating vectors between shards in the background.' },
      { question: 'How fresh are upserts? Can a vector be queried 100ms after insert?', answer: 'On the primary, yes — HNSW supports online inserts in O(log N) and the new vector is in the graph immediately. The catch is the replica lag: asynchronous replication takes 100ms-1s, so reads routed to a replica may not see the new vector for that long. For workloads needing read-your-writes (e.g. ingesting a doc and immediately querying it), the SDK can route reads to the primary or include a brute-force scan over a small "recent writes" buffer of items not yet visible on the routed replica.' },
      { question: 'Why is hybrid search (dense + sparse) better than pure vector search?', answer: 'Embeddings encode semantic similarity well but lose exact-keyword signals. A query for "error code E_404_TOKEN_EXPIRED" will match passages discussing similar errors semantically, but the exact error string is the ground truth answer. BM25-style sparse search finds the exact match. Fusing dense (semantic) and sparse (exact) results via Reciprocal Rank Fusion typically lifts recall@10 by 5-15 points on enterprise corpora. Some systems implement SPLADE-style learned sparse vectors that combine the two in a single index. The cost is operating both index types, but the recall improvement justifies it for any production retrieval workload.' },
    ],
  },
  {
    id: 36,
    slug: 'design-flash-sale',
    title: 'Design an E-commerce Flash Sale',
    difficulty: 'Hard',
    category: 'Mobile & APIs',
    tags: ['flash-sale', 'inventory', 'concurrency', 'hot-key', 'queue', 'fraud'],
    problemStatement: `Design the systems behind a flash sale — a high-demand product (PlayStation drop, limited sneaker release) goes on sale at an announced time, attracting 100× normal traffic in the first minute. The system must sell exactly the available inventory, no more, no fewer, while keeping the rest of the site responsive and resisting bots. Target: 1M concurrent users at T=0, 10K items, sale closes in 30s.`,
    requirements: {
      functional: [
        'Open the sale at a precise time; reject earlier requests',
        'Sell inventory atomically — never oversell or undersell',
        'Reserve items in cart for a TTL; release if abandoned',
        'Accept payment and convert reservations into confirmed orders',
        'Show the buyer their queue position and ETA',
        'Limit purchases per customer (e.g., 1 per account)',
      ],
      nonFunctional: [
        'Inventory decrement < 5ms P99 even at 100K rps',
        'Zero oversell — strict correctness on the count',
        'Survive a 100× traffic spike without affecting the rest of the site',
        'Distinguish bots from humans with <1% false positive on humans',
        'Recover gracefully if payment fails — return inventory to the pool',
      ],
    },
    capacityEstimates: `Concurrent users at T=0: ~1M\nRequest spike: ~100K rps for ~30s, 5–10K rps steady state\nInventory: 10K units in a single Redis key (hot key risk)\nCart TTL: 5–10 min reservation window\nPayment success rate: ~80% — expect to recycle ~20% of reservations back to inventory\nQueue / waiting room: holds up to 1M parked sessions, drips through at ~5K/s`,
    solutionBreakdown: [
      { section: 'Traffic Shape and Why Normal Design Fails', content: 'At T=0 you go from ~1K rps to ~100K rps in milliseconds. Two things break:\n  1. The database row holding the inventory count becomes a hot row — every request tries to lock it. Postgres can do hundreds of UPDATEs per second per row; you need tens of thousands.\n  2. The rest of the site (product browsing, account pages) shares the same DB and app servers, so the flash sale takes down everything else as a side effect.\n\nThe design pattern is:\n  • Move inventory off the OLTP database onto a single in-memory atomic counter (Redis).\n  • Front the sale with a virtual waiting room that admits users at a controlled drip.\n  • Isolate the flash-sale stack (its own services, queues, DBs) from the main site so a meltdown is contained.' },
      { section: 'Atomic Inventory with Redis + Lua', content: 'Inventory lives as a single Redis key inventory:{sku}={n}. Decrement is done via a Lua script (atomic on Redis):\n\n  local n = tonumber(redis.call("GET", KEYS[1]))\n  if not n or n < tonumber(ARGV[1]) then return -1 end\n  return redis.call("DECRBY", KEYS[1], ARGV[1])\n\nReturns -1 if not enough inventory, else the new count. Redis on a modern box handles 100K+ Lua-script ops/sec on a single key. Because the script is atomic on the server, two parallel attempts to take the last unit cannot both succeed.\n\nThe DB still holds the authoritative inventory at the start and end of the sale — Redis is a fast working set seeded at sale open and reconciled at sale close. If Redis is lost mid-sale, you fall back to a "sale paused" state and rebuild from the order log, not from the DB.' },
      { section: 'Hot Key Sharding', content: 'A single SKU at 100K rps still risks a single Redis shard saturating its CPU. Pattern: shard the inventory across N counters and have clients pick a shard at random:\n\n  inventory:{sku}:shard:0..N-1   (sum = total inventory)\n\nDecrement: client hashes the request to a shard and tries that one. If it returns -1 (empty), it falls back to the next shard. When one shard is empty, the system is N-1 shards away from over-decrementing zero, so this is safe.\n\nN is sized to spread load — e.g., 16 shards × 10K rps each on the hottest sale. Pre-seeding: split the 10K-unit inventory roughly evenly across shards at sale open.\n\nDownside: harder to read "remaining count" precisely — you have to sum N shards. Acceptable since the customer-visible count is approximate anyway ("almost gone").' },
      { section: 'Virtual Waiting Room', content: 'When the sale opens with 1M concurrent users, the inventory itself only has 10K units — letting everyone in is pointless. A waiting room admits users at a controlled rate and gives the rest a fair queue position.\n\nImplementation:\n  • Edge layer (CloudFront Lambda@Edge or a CDN worker) issues a signed cookie containing { queue_position, admitted_at }.\n  • Position is assigned by a per-region Redis ZADD with the connection timestamp as score.\n  • Admission service drains the queue at a rate proportional to (inventory_remaining / expected_conversion_rate / sale_duration). E.g., for 10K units and 20% conversion in 30s: admit ~5K/s.\n  • Admitted users get a short-lived JWT (60s) that they present to the inventory service. Inventory service rejects requests without a valid admission JWT.\n\nWhy at the edge: keeps the waiting-room traffic completely off the origin app servers. You\'re only doing cheap cookie ops per request.' },
      { section: 'Cart Reservation with TTL', content: 'Decrementing inventory and waiting for payment are decoupled. On a successful DECR:\n  1. Reservation written to Redis cart:{user_id} = {sku, qty, reserved_at} with a TTL of 8 minutes.\n  2. The user is shown a checkout page with a visible countdown.\n  3. On payment success: convert reservation to a real order (next section).\n  4. On TTL expiry without payment: a Redis keyspace notification triggers a "release inventory" Lambda that does INCRBY back to inventory:{sku} and emits an event.\n\nWhy a TTL: users abandon. Without expiry, 30% of inventory would be locked by people who closed the tab. With 8 minutes, you have a moving capacity that gets recycled.\n\nNote: at sale close, any remaining reservations still respect their TTL. The total can briefly show negative against initial stock (because returns happen after the official sale ends) — that\'s fine, the inventory key is the truth.' },
      { section: 'Order Pipeline and Payment Reservation', content: 'Once a cart converts (user clicks "pay"):\n  1. Create order in PENDING_PAYMENT state — single transaction, separate write to the orders DB.\n  2. Call the payment system (see Design a Payment System) with an idempotency_key = order_id. Synchronous up to a 3s timeout.\n  3. On success: order → CONFIRMED, send confirmation, remove reservation. The inventory stays decremented.\n  4. On failure: order → FAILED, increment inventory back (INCRBY on the inventory key), remove reservation.\n  5. On timeout: order → PENDING_RECONCILIATION; a janitor job retries against the PSP within 60s and resolves.\n\nThe critical correctness property: at every observable moment, decremented_count = confirmed_orders + active_reservations + recoveries_in_flight. A reconciler runs every minute during the sale to catch drift.' },
      { section: 'Per-Customer Limits', content: 'Without limits, one buyer takes all 10K units in a script. Two checks:\n  1. Per-account: Redis SETNX limit:{sku}:{user_id} with TTL = sale_duration. If already set, reject. This catches account-multi-purchase.\n  2. Per-payment-method: a separate SETNX on a hash of (cc_token, billing_address). Catches one user buying through multiple accounts with the same card.\n\nAccount-level only is the bare minimum. Sophisticated drops also rate-limit by device fingerprint, IP, and ASN (with manual unblock for shared corporate networks).' },
      { section: 'Bot Mitigation', content: 'Three layers, each catches a different population:\n  1. Edge bot detection — Cloudflare Bot Management / hCaptcha invisible challenges before the waiting room. Catches script-kiddies and known headless browsers.\n  2. Behavioural signals — TLS fingerprint (JA3), mouse-movement entropy, time-to-click after page load. A real human takes ~2s; a bot takes 80ms.\n  3. Async post-purchase scoring — after the sale, score every order on trust and cancel obviously fraudulent ones before fulfilment.\n\nNo single layer is sufficient. The goal isn\'t "stop all bots" (impossible) but "make bots expensive enough to lose market share to humans". For a $500 sneaker, you can spend $0.10 of fraud spend per attempt and still come out ahead.' },
      { section: 'Read Path: Stay Responsive', content: 'Most of the 1M concurrent users are not in the queue yet — they\'re hitting the product page, checking sale time, refreshing. That read load can melt the site separately from the inventory contention.\n\n  • The product page is fully static (rendered at build time, served from CDN).\n  • A "is the sale live?" endpoint is cached at the edge with a 5s TTL and reads from Redis only on cache miss.\n  • Remaining-inventory display is heavily debounced — clients pull every 10s, the endpoint returns coarse buckets ("plenty", "low", "going fast") not exact counts. Removes a hot read path entirely.\n  • Account/login flows for the sale are isolated from the main site\'s auth tier so a sale meltdown doesn\'t lock people out of the rest of the catalogue.' },
      { section: 'Failure Modes', content: 'Specific scenarios and how the design covers them:\n  • Redis primary fails mid-sale → automatic failover to replica. Replica may have lost the last few decrements; on promotion, replay the last N seconds of the order log to converge. During failover, inventory writes pause for ~5s.\n  • Payment system is slow → reservations TTL but orders are stuck in PENDING_PAYMENT. The reconciler eventually resolves; the customer sees a "we\'re still confirming" page. This is the worst UX of any failure mode and the one to invest in optimising.\n  • Waiting room admits too fast → admission rate is dynamic, computed from observed conversion rate. If conversion spikes (low-friction signed-in users), we slow admission. If conversion drops (everyone\'s bouncing), we speed it up.\n  • Inventory accidentally over-decremented (bug) → the Lua script never returns success for inventory < 0, so this requires a bug above the script (double-spending an admission token). The reconciler catches it within a minute and refunds the duplicate orders. Customer trust is preserved by being explicit about the bug and refunding before they notice.' },
      { section: 'Observability', content: 'Dashboards segmented by the sale (not aggregated with rest of site):\n  • Real-time: rps at edge, admission rate, decrement_rps, payment_success_rate, reservation_conversion_rate, cart_TTL_expiry_rate.\n  • Inventory health: per-shard counter values, time since last decrement, sum across shards vs initial allocation.\n  • Bot signal: ratio of admissions that came from challenged sessions, captcha solve rate.\n  • Fraud signal: orders blocked by per-customer limit, post-sale risk score distribution.\n\nAlerting that pages on-call mid-sale:\n  • decrement_rps falls to zero with inventory remaining (something\'s wedged).\n  • payment_success_rate drops below 50% (PSP problem).\n  • reservation_TTL_expiry_rate above 40% (admission rate too high — customers can\'t check out fast enough).\n\nPost-mortems on every sale are mandatory. Every drop is a load test in production.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Web[Web Buyer]
        Mobile[Mobile Buyer]
        Bot[Suspected Bot Traffic]
    end
    subgraph Edge
        CDN[Static CDN Product Page]
        WAF[WAF and Bot Detection]
        Edge[Edge Worker Waiting Room]
        Geo[Geo-DNS]
    end
    subgraph Gateway
        APIGW[Sale API Gateway]
        Auth[Auth and Session]
        RL[Per-Customer Rate Limiter]
        AdmJWT[Admission JWT Verifier]
    end
    subgraph Services
        QueueSvc[Waiting Room Queue Svc]
        AdmSvc[Admission Rate Controller]
        InvSvc[Inventory Service]
        CartSvc[Cart Reservation Svc]
        Checkout[Checkout Service]
        OrderSvc[Order Service]
        PaymentClient[Payment System Client]
        LimitSvc[Per-Customer Limit Svc]
        ReconSvc[Inventory Reconciler]
    end
    subgraph Async
        TTLSweeper[Reservation TTL Sweeper]
        OrderQ[Order Confirmation Queue]
        FraudScorer[Post-Sale Fraud Scorer]
        ReplayJob[Decrement Log Replay]
        Analytics[Analytics Streamer]
    end
    subgraph Storage
        InvRedis[(Inventory Redis Sharded Counters)]
        CartRedis[(Cart Reservations Redis TTL)]
        QueueRedis[(Waiting Room ZSET Redis)]
        LimitRedis[(Per-Customer Limits Redis)]
        OrdersDB[(Orders DB Postgres)]
        DecLog[(Decrement Audit Log)]
        SaleConfig[(Sale Config DB)]
    end
    subgraph Analytics
        EventBus[Kafka Sale Events]
        Lake[(Data Lake)]
        Dash[Realtime Dashboard]
    end

    Web -->|product page| Geo --> CDN
    Mobile --> Geo
    Web -->|join sale| WAF --> Edge
    Mobile --> WAF
    Edge --> QueueSvc --> QueueRedis
    Edge --> AdmSvc
    AdmSvc --> SaleConfig
    AdmSvc -->|signed JWT| Edge

    Edge -->|admitted| APIGW
    APIGW --> Auth
    APIGW --> AdmJWT
    APIGW --> RL --> LimitRedis
    APIGW --> InvSvc
    InvSvc -->|Lua DECR| InvRedis
    InvSvc --> DecLog
    InvSvc --> CartSvc --> CartRedis
    CartSvc -->|TTL expiry event| TTLSweeper --> InvSvc

    CartSvc --> Checkout --> OrderSvc --> OrdersDB
    OrderSvc --> PaymentClient
    PaymentClient -.->|failure| InvSvc
    OrderSvc --> OrderQ --> FraudScorer
    OrderSvc --> LimitSvc --> LimitRedis

    DecLog --> ReplayJob
    InvRedis --> ReconSvc --> OrdersDB

    Bot --> WAF
    InvSvc --> EventBus --> Lake
    EventBus --> Dash
    EventBus --> Analytics

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class InvRedis,CartRedis,QueueRedis,LimitRedis,OrdersDB,DecLog,SaleConfig storage
    class TTLSweeper,OrderQ,FraudScorer,ReplayJob,Analytics async
    class CDN,WAF,Edge,Geo edge
    class EventBus,Lake,Dash analytics`,
    tradeoffs: [
      { decision: 'Redis atomic counter vs database row', rationale: 'Redis Lua scripts handle 100K+ ops/sec on a single key with atomic guarantees; an OLTP database tops out at hundreds for a hot row. Trade-off: Redis is a less durable system of record — you accept reconciling the audit log against orders at sale close and on failover. The database remains the authoritative inventory at rest.' },
      { decision: 'Hot-key sharding vs single key', rationale: 'Sharding spreads load across Redis shards but makes "exact count" queries expensive (must sum). Single key keeps the count exact but caps throughput per SKU. Almost always shard when peak rps per SKU exceeds ~30K.' },
      { decision: 'Waiting room at the edge vs in the app', rationale: 'Edge waiting rooms keep the spike off your origin entirely — your app sees a steady, controlled stream. Cost: more complex (custom edge logic, signed cookies). In-app queuing is simpler but every parked user still hits your servers. For >10× spikes the edge approach is essentially required.' },
      { decision: 'Synchronous reservation vs queue-and-confirm', rationale: 'Synchronous: user clicks "buy", sees instant confirm or fail. Higher abandonment for failed payments, better UX for successes. Queue-and-confirm: every successful inventory decrement enqueues an order to a downstream worker that handles payment async; user sees "we will email you". Better behaviour under PSP overload, worse perceived UX. Most consumer drops are synchronous.' },
      { decision: 'Per-customer limit by account vs payment method vs device', rationale: 'Account limits are cheap and bypassed by anyone with multiple accounts. Payment-method limits catch reuse of one card. Device fingerprinting catches sophisticated bot farms but has false positives on shared family devices. Stack all three with decreasing strictness — auto-cancel on account/payment violations, manual review on device-only signals.' },
    ],
    keyTakeaways: [
      'Move inventory off the OLTP database onto an atomic in-memory counter — the row lock is the bottleneck, and a Redis Lua script removes it',
      'A virtual waiting room at the edge is the only practical way to handle a 100× spike without your origin melting',
      'Reservations with TTLs are essential — without them, abandoned carts permanently lock 20–30% of inventory',
      'Every layer of the stack needs idempotency: the inventory script, the order create, the payment call, the inventory return on failure',
      'Bot mitigation is a layered defence; no single mechanism stops a determined adversary, the goal is to make bots more expensive than humans',
    ],
    faqs: [
      { question: 'Why use Redis for inventory instead of just an indexed DB column with SELECT FOR UPDATE?', answer: 'SELECT FOR UPDATE on a single row serialises all writers through that row\'s lock. Postgres can do a few hundred such transactions per second on a single row; we need 100K. Redis is single-threaded per shard but each op is nanoseconds in memory rather than a multi-step ACID transaction, so a single Redis shard handles tens of thousands of Lua-script ops/sec on the same key.\n\nThe DB still matters: it holds the authoritative inventory at sale open and absorbs the order writes downstream. Redis is the high-throughput hot path during the sale itself. At sale close, you reconcile Redis decrements against confirmed orders and update the DB.' },
      { question: 'What happens if Redis loses the inventory counter mid-sale?', answer: 'Three protections:\n  1. Redis is configured with AOF persistence (fsync every second) on a replicated cluster. On primary failure, the replica is promoted; you lose at most ~1s of decrements.\n  2. Every successful DECR also writes to a Kafka decrement_log (or DB). On Redis crash, the log is the source of truth for what was sold — you can replay it onto a freshly initialised counter.\n  3. The sale enters a "paused" state if Redis health degrades. New buyers see a "verifying inventory" page rather than potential oversell. Better one minute of pause than a thousand-unit oversell.\n\nThe reconciler runs continuously and flags drift between (initial inventory − decrements_in_log) and (Redis current value). Drift > some threshold pages on-call.' },
      { question: 'How do you stop someone scripting the inventory decrement?', answer: 'You can\'t completely — but you make it not worthwhile. Stacked defences:\n  • Edge bot detection (WAF + TLS fingerprint) rejects ~80% of script traffic before it ever hits your origin.\n  • Admission JWT is required to call the inventory endpoint — and it\'s only issued by the waiting room. Scripts that skip the queue get rejected.\n  • Per-account limit: SETNX on user_id, sale-duration TTL. One purchase per account.\n  • Per-payment-method check: same SETNX on hash(card_token, address).\n  • Post-sale fraud scoring cancels orders that look automated (new account + new card + unusual delivery address combination) before fulfilment.\n\nResult: a determined attacker can still buy a few units across many accounts and cards. The economics of running that operation are usually unfavourable at scale.' },
      { question: 'What if the payment system is slow during the sale?', answer: 'This is the failure mode most likely to ruin a sale. Defences in priority order:\n  1. The payment call is timed out at 3s and queued for async retry on timeout, so a slow PSP doesn\'t pin the user\'s request thread.\n  2. On payment timeout, the order goes to PENDING_PAYMENT, not FAILED. We don\'t release inventory until we know the payment failed.\n  3. The reconciler retries the PSP\'s GET endpoint until a definitive answer; up to 60s. If still PENDING after that, customer sees a "we will email confirmation" page.\n  4. Multi-PSP routing means a single PSP slowdown doesn\'t hit 100% of buyers.\n\nThe inventory is briefly underconsumed (decremented but no confirmed order) — this is fine. The reconciler cleans up after.' },
      { question: 'How do you show the buyer their queue position fairly?', answer: 'On join, the edge worker does a Redis ZADD waiting_room {timestamp_ms} {session_id}. Position is the rank of that session_id in the sorted set. The position is shown to the user as "you are #324,123 of 1,000,000". The admission service drains from the lowest rank (oldest first) at the admission rate.\n\nFairness considerations:\n  • Per-region queues prevent a US user from being stuck behind 500K EU users for an EU-only sale.\n  • The score should be the actual arrival timestamp, not a counter, so brief network blips don\'t reorder users.\n  • Display "ETA" as a tight range, not a point estimate, because admission rate varies.\n\nWhat you do not do: bump high-value customers up the queue without disclosing it. That gets discovered and burns trust.' },
      { question: 'Why expose coarse inventory ("almost gone") instead of exact count?', answer: 'Two reasons:\n  1. Performance — exact count is a sum across N sharded counters. At 1M concurrent users polling every second, that\'s 1M reads/s of an N-key sum. Coarse buckets ("plenty", "low", "going fast") can be cached at the edge with a 10s TTL.\n  2. Manipulation resistance — exact counts let bots probe the system ("am I close enough that decrementing is profitable?"). Coarse counts force them to commit before knowing the exact state.\n\nThere\'s a small trust trade-off: customers may distrust "going fast" if they\'ve seen it gamed. Honesty post-sale (publish exact units sold and to whom — anonymised) builds back trust.' },
      { question: 'How is this different from a hotel/flight booking system?', answer: 'Booking systems care about a calendar of available slots over time (rooms × nights). Their concurrency is on a small number of items but spread over many dates, and their hold-times can be 15 minutes with little harm. Flash sales care about a single SKU with thousands of buyers contending for one decrement op, and the entire sale lasts seconds. Different read pattern (heavy hot-key contention vs heavy index scan for availability), different write pattern (one counter vs many overlapping date ranges), different fraud profile (bot-script supply hoarding vs scalpers).\n\nFor a unified booking + drop system (e.g., concert tickets with timed sales — see Design Ticketmaster), you combine both patterns.' },
      { question: 'What about the rest of the catalogue during the sale?', answer: 'Isolate or it goes down with the sale. Specifics:\n  • The sale stack runs in its own service mesh / cluster — separate ASGs, separate DBs, separate Redis.\n  • Shared services (auth, accounts) are sized for the full spike and circuit-broken so the sale can\'t starve them.\n  • The main site\'s read path goes through its own caches; nothing on the hot path queries the sale\'s Redis.\n  • Internal APIs the sale stack calls into the main stack (e.g., to look up user address) have client-side circuit breakers — the sale degrades to "address required, please retry" rather than crashing.\n\nThe goal: a meltdown of the sale stack causes the sale to fail, not the whole business.' },
    ],
  },
  {
    id: 37,
    slug: 'design-ticketmaster',
    title: 'Design Ticketmaster',
    difficulty: 'Hard',
    category: 'Mobile & APIs',
    tags: ['booking', 'inventory', 'seat-map', 'queue', 'bot-mitigation', 'dynamic-pricing'],
    problemStatement: `Design a live-event ticketing platform like Ticketmaster. Users browse events, see a seat map, select specific seats, hold them while completing payment, and receive a ticket. The system must handle concert on-sales where 2M people hit the site for 50,000 tickets in 60 seconds, prevent two users from buying the same seat, resist bot armies, and support dynamic pricing and verified resale. Target: 2M concurrent at on-sale, 100M tickets/year.`,
    requirements: {
      functional: [
        'Browse events, filter by date/venue/artist',
        'View interactive seat map with per-seat pricing and availability',
        'Select seats and hold them for a TTL while paying',
        'Process payment and issue digital tickets (QR / NFC)',
        'Verified resale marketplace with price caps and identity binding',
        'Virtual waiting room with fair queue position per event',
        'Dynamic pricing tiers (presale, general, last-minute)',
      ],
      nonFunctional: [
        'Zero double-booking — a seat is sold to one buyer or no one',
        'Seat map read p99 < 200ms during on-sale',
        'Hold/release seat operation < 50ms p99',
        'Survive 100× normal traffic during on-sale',
        '99.9% available during on-sale (down for 5 min = catastrophe)',
        'Bot detection with <1% false positive on humans',
      ],
    },
    capacityEstimates: `On-sale peak: 2M concurrent connections, ~200K rps for ~3 min\nSteady state: 50K rps\nSeat inventory per event: up to 100K seats stored as a seat-status grid\nHolds: ~3M outstanding mid-sale (15M attempts × 20% pass-through), 8 min TTL each\nPayment integrations: multiple PSPs with multi-region routing\nWaiting room: queues up to 2M parked sessions per event`,
    solutionBreakdown: [
      { section: 'Why This Is Hard', content: 'Two patterns collide at on-sale:\n  1. Hot-inventory concurrency (like a flash sale) — thousands of buyers contending for the same seat.\n  2. Multi-dimensional inventory — each event has tens of thousands of distinct seats, each with its own pricing tier, view-quality rating, accessibility metadata, and availability state.\n\nA pure flash-sale design (single atomic counter) doesn\'t work because buyers want specific seats. A pure booking-system design (DB row per seat) doesn\'t work because the hot path is too contended. The answer is a hybrid: per-section in-memory inventory with a seat-level hold layer in Redis, fronted by an aggressive waiting room and bot defence.' },
      { section: 'Event and Seat Inventory Model', content: 'Two tables for each event:\n  events(id, artist, venue_id, doors_open_at, on_sale_at, total_seats, status)\n  seats(event_id, section, row, seat_no, tier, price_cents, accessibility_flags, status)\n      PK = (event_id, section, row, seat_no)\n\nstatus enum: AVAILABLE | HELD | SOLD | RESERVED_HOLDBACK | RELEASED\n\nAt event creation, ~100K seat rows are inserted. The seats table is the source of truth at rest but is never the hot read/write path at on-sale. Instead, at on-sale open, the entire seat grid is materialised into Redis as a per-section hash:\n\n  event:{eid}:section:{sid} = { "R5S12": "AVAILABLE", "R5S13": "HELD:hold_id", ... }\n\nThis allows whole-section reads (the user wants to see "show me upper-bowl seats") with one Redis call and atomic per-seat updates via HSET CAS.' },
      { section: 'Seat Map Read Path', content: 'When the user opens the seat map:\n  1. The event\'s static metadata + base seat layout is fetched from CDN (rendered at event creation, cacheable for hours).\n  2. The live availability overlay is fetched from Redis with one HGETALL per section the user is viewing — typically just one section unless they zoom out.\n  3. Client renders the seat map as SVG with hovered availability state.\n\nBecause sections are independent hashes, a single section being mutated heavily doesn\'t slow reads of other sections. Polling at 2s intervals during shopping is fine; WebSocket push for live updates is a polish move (worth it for premium events).' },
      { section: 'Seat Hold with TTL and Atomic CAS', content: 'When the user clicks a seat:\n  HOLD operation, Lua script atomically:\n    1. HGET event:{eid}:section:{sid} field {row}{seat}\n    2. If status != "AVAILABLE", return REJECT.\n    3. HSET to "HELD:{hold_id}", set held_at, write hold record.\n    4. Set TTL on a separate key hold:{hold_id} = {seats, user_id, expires_at} for 8 min.\n  Return ACCEPT with hold_id.\n\nMulti-seat purchases (group of 4) are a single Lua call that either holds all 4 or none. Using Redis hash CAS for each seat means contention is fine-grained — only buyers fighting for the exact same seat conflict.\n\nOn TTL expiry (Redis keyspace notification), an async worker releases each seat back to AVAILABLE and deletes the hold record. The release path is itself a Lua script that checks the seat is still HELD:{hold_id} before flipping it back, so a late confirmation can\'t race with a release.' },
      { section: 'Virtual Waiting Room with Fair Per-Event Queue', content: 'On-sale opens at a published moment. A waiting room is the only way to manage the spike fairly:\n  • Edge worker enqueues each session into a per-event Redis sorted set with score = arrival timestamp.\n  • Admission service drains the queue at a controlled rate, computed from observed conversion (tickets sold per admitted user).\n  • Each admitted session gets a 60s JWT scoped to that event. The seat APIs reject requests without a valid admission JWT.\n\nThe queue is per-event so a Taylor Swift on-sale doesn\'t back up smaller concurrent on-sales. Regional sub-queues prevent geographic unfairness on tour-wide on-sales.\n\nThe waiting room also fingerprints sessions: TLS fingerprint, header set, behavioural signals. High-trust sessions (logged-in account with purchase history, presale code, mobile app) are admitted faster than fresh anonymous browser sessions. This is the lever that limits bot-controlled inventory without losing too many real fans.' },
      { section: 'Bot Mitigation and Trust Scoring', content: 'Industry rule of thumb: at a major on-sale, 60–90% of incoming traffic is automated. Defences:\n\n  1. Pre-admission challenges — invisible bot detection (Akamai BotManager, Cloudflare Turnstile) at the edge. Reject obvious script clients. Escalate to a captcha for suspicious cases.\n  2. Account binding — high-demand on-sales require a registered account with a verified phone number and a payment method on file before the on-sale opens. This makes account farms expensive.\n  3. Presale codes — a code distributed to fans (via the artist\'s mailing list) is required for early access. The code is single-use, account-bound, and rate-limited per IP.\n  4. Per-customer ticket caps — 4 tickets per account per show is typical. Enforced via SETNX on (account_id, event_id) with sale-duration TTL.\n  5. Async post-purchase scoring — every order is scored on 200+ features and orders with risk score > threshold are cancelled and refunded before tickets are issued. Customer-visible: "your order is being verified."\n  6. Identity binding at issuance — for premium events, tickets are bound to the buyer\'s photo ID and only that person can use them. Defeats the resale model for that event.\n\nNo single layer wins. Together they make running a profitable bot operation hard.' },
      { section: 'Dynamic Pricing', content: 'Three pricing modes that coexist:\n  • Tier pricing — fixed prices per section ($150 floor, $90 mezz, $50 upper). Set at event creation.\n  • Presale tiers — discounted prices during a limited presale window, controlled by promo code.\n  • Demand-based ("platinum" / "official platinum") — prices float in response to demand, reset every few minutes by a pricing service that reads (holds / available_seats) per section and pushes new prices to a pricing cache.\n\nPricing cache is Redis with a 30s TTL. The price the user sees is the price they pay — once a hold is placed, the price is locked to the hold record, even if the cache updates before checkout completes. This avoids "price changed during checkout" disputes.\n\nDynamic pricing is contentious — it captures money that would otherwise go to scalpers, but creates PR risk ("Ticketmaster charged $500 for a $90 seat"). System should be capable of disabling dynamic pricing per event at the artist\'s request.' },
      { section: 'Checkout, Payment, and Ticket Issuance', content: 'Once a hold is established and the user clicks "purchase":\n  1. Order created in PENDING with order_id = hold_id (one-to-one).\n  2. Payment system called synchronously with idempotency_key = order_id (see Design a Payment System).\n  3. On payment success: a Lua script atomically converts every HELD:{hold_id} seat to SOLD:{order_id}, marks the order CONFIRMED, and enqueues ticket issuance.\n  4. Ticket issuance generates a per-ticket QR / NFC payload signed with a rotating HMAC key, stores the ticket record, sends to the user.\n\nFailure paths:\n  • Payment declined → release holds, mark order FAILED, the seats become available again.\n  • Network drop after PSP success → the payment system\'s idempotency replays the success; our reconciler converts holds to SOLD.\n  • Holds TTL expires while payment is in flight → the order is in PENDING but seats may have been released. A janitor catches this and either re-holds or refunds.' },
      { section: 'Verified Resale Marketplace', content: 'Scalping is the visible problem; verified resale is the platform\'s answer.\n  • A SOLD ticket can be listed for resale at the original purchase price up to N% above (configurable per artist; some require resale ≤ face value).\n  • The buyer is matched to a SOLD ticket; on payment, the ticket is invalidated and a new ticket is issued to the buyer bound to their identity.\n  • The seller is paid via the merchant payout path; the platform takes a fee.\n  • Listings include verified original-purchase provenance — the buyer knows the ticket is real, not a fake screenshot.\n\nThis runs as a separate service against the same seat/order DB. The atomicity is "transfer ticket from seller to buyer" — done as a single DB transaction. Identity binding at the venue door is what makes the marketplace work; it eliminates the secondary scalping market because tickets can\'t be resold off-platform.' },
      { section: 'Section-Level Sharding', content: 'A 100K-seat stadium on a single Redis shard would saturate during on-sale. Shard inventory by (event_id, section_id) so each shard handles ~5K seats. Hot sections (floor, sound-of-stage) get their own shards if traffic is uneven.\n\nThe routing layer maintains a mapping (event_id, section_id) → redis_shard, refreshed from a control plane every minute. Section-level sharding is enough — seat-level would just multiply round trips for no win, since most contention is within the same hot section anyway.' },
      { section: 'Notification System', content: 'Several notification flows (see Design a Notification System for the underlying mechanism):\n  • Pre-sale reminder push 24h, 1h, 5 min before on-sale.\n  • Waiting room ETA updates (push when the user is admitted).\n  • Hold expiration warning (2 min before TTL).\n  • Purchase confirmation with ticket attachment.\n  • Day-of-event reminders with venue info and ticket QR.\n  • Event changed/cancelled notifications.\n\nAll of these are templated and routed through the notification service\'s priority queues. Day-of-event reminders are the lowest priority; "your hold is about to expire" is the highest because they\'re time-critical.' },
      { section: 'Failure Modes', content: '  • Waiting room admits too many at once → admission rate is dynamic, controlled per shard. If decrement_latency or hold_failure_rate climbs, admission slows automatically.\n  • Redis hash CAS fails consistently → likely a hot section is sharded too coarsely. Operators can re-shard a single section live by issuing a freeze on writes, copying to the new shard, and routing flips. Lasts ~30s.\n  • Holds wedged in PROCESSING after PSP timeout → reconciler retries PSP within 60s, either confirms or releases.\n  • Mass cancellation event (artist drops out) → an event-level command sets every SOLD ticket to PENDING_REFUND, the refund pipeline processes them in batches with auto-generated emails.\n  • DDoS during on-sale → distinct from legitimate spike. Edge layer fingerprints and rate-limits ASNs / IP blocks; the bot detection layer is the same code, just tuned more aggressively. The waiting room itself does most of the protection by parking attackers in the queue rather than letting them hit origin.' },
      { section: 'Observability', content: 'Real-time dashboards split per on-sale event:\n  • Waiting room: queue depth, admission rate, observed conversion, drop-off rate.\n  • Inventory: per-section hold count, sold count, available count, hold→sold conversion.\n  • Payment: per-PSP auth rate, p99 latency, multi-PSP routing distribution.\n  • Bot signal: pre-admission rejection rate, captcha presented rate, captcha solve rate.\n  • Customer: hold TTL expiry rate (high = admission rate too aggressive).\n  • Trust: post-purchase cancellation rate (high = bot mitigation too lax).\n\nThe ratio of admitted users to tickets sold is the master health metric — too high means you\'re wasting people\'s time in the queue; too low means you ran out of seats faster than expected. Target is calibrated per artist.' },
    ],
    diagram: `graph TB
    subgraph Clients
        Web[Web Browser]
        Mobile[Mobile App]
        BoxOffice[Box Office Terminal]
    end
    subgraph Edge
        CDN[Static CDN Seat Maps]
        WAF[WAF and Bot Detection]
        EdgeWR[Edge Waiting Room]
        Geo[Geo-DNS]
    end
    subgraph Gateway
        APIGW[API Gateway]
        Auth[Auth and Account Svc]
        AdmJWT[Admission JWT Verifier]
        RL[Per-User Rate Limit]
    end
    subgraph Services
        EventSvc[Event Catalog Service]
        SeatMapSvc[Seat Map Service]
        HoldSvc[Hold Service]
        CheckoutSvc[Checkout Service]
        OrderSvc[Order Service]
        TicketSvc[Ticket Issuance Service]
        PaymentClient[Payment System Client]
        PricingSvc[Dynamic Pricing Service]
        TrustSvc[Trust and Bot Scoring]
        ResaleSvc[Verified Resale Service]
        QueueSvc[Waiting Room Queue Svc]
        AdmSvc[Admission Rate Controller]
        NotifClient[Notification Client]
    end
    subgraph Async
        TTLSweeper[Hold TTL Sweeper]
        FraudScorer[Post-Purchase Fraud Scorer]
        PricingTrainer[Pricing Model Updater]
        TicketGen[Ticket QR Generator]
        ReconJob[Inventory Reconciler]
        CancelBatcher[Mass Cancel Batcher]
    end
    subgraph Storage
        EventDB[(Events DB Postgres)]
        SeatsDB[(Seats Catalog DB)]
        SeatInv[(Seat Inventory Redis per Section)]
        Holds[(Holds Redis TTL)]
        OrdersDB[(Orders DB)]
        TicketsDB[(Issued Tickets DB)]
        PricingCache[(Pricing Cache Redis)]
        ResaleDB[(Resale Listings DB)]
        TrustStore[(Trust Score Feature Store)]
        QueueZSet[(Waiting Room ZSET)]
    end
    subgraph Analytics
        EventBus[Kafka Sale Events]
        Lake[(Data Lake)]
        Dash[On-Sale Dashboard]
    end

    Web -->|browse| Geo --> CDN
    Web -->|on-sale start| WAF --> EdgeWR
    Mobile --> WAF
    EdgeWR --> QueueSvc --> QueueZSet
    EdgeWR --> AdmSvc --> EventDB
    AdmSvc -->|admission JWT| EdgeWR

    EdgeWR -->|admitted| APIGW
    APIGW --> Auth
    APIGW --> AdmJWT
    APIGW --> RL
    APIGW --> EventSvc --> EventDB
    APIGW --> SeatMapSvc --> SeatInv
    SeatMapSvc --> SeatsDB
    SeatMapSvc --> PricingSvc --> PricingCache

    APIGW -->|select seats| HoldSvc
    HoldSvc -->|Lua CAS| SeatInv
    HoldSvc --> Holds
    Holds -.->|TTL expiry| TTLSweeper --> HoldSvc

    APIGW -->|checkout| CheckoutSvc --> OrderSvc --> OrdersDB
    OrderSvc --> PaymentClient
    PaymentClient -.->|fail| HoldSvc
    OrderSvc --> TrustSvc --> TrustStore
    OrderSvc --> FraudScorer
    OrderSvc --> TicketSvc --> TicketsDB
    TicketSvc --> TicketGen --> TicketsDB
    TicketSvc --> NotifClient

    BoxOffice --> APIGW

    APIGW -->|resale| ResaleSvc --> ResaleDB
    ResaleSvc --> TicketsDB
    ResaleSvc --> PaymentClient

    SeatInv --> ReconJob --> SeatsDB
    EventBus --> CancelBatcher --> OrderSvc

    PricingTrainer --> PricingCache
    HoldSvc --> EventBus
    OrderSvc --> EventBus
    EventBus --> Lake
    EventBus --> Dash

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class EventDB,SeatsDB,SeatInv,Holds,OrdersDB,TicketsDB,PricingCache,ResaleDB,TrustStore,QueueZSet storage
    class TTLSweeper,FraudScorer,PricingTrainer,TicketGen,ReconJob,CancelBatcher async
    class CDN,WAF,EdgeWR,Geo edge
    class EventBus,Lake,Dash analytics`,
    tradeoffs: [
      { decision: 'Per-section Redis hash vs per-seat key', rationale: 'Per-section hash lets one HGETALL fetch a whole section\'s availability for the seat map view, and HSET CAS handles individual holds. Per-seat keys allow finer-grained sharding but multiply round trips for reads and complicate atomic multi-seat holds. Per-section wins because the dominant read pattern is "show me this section".' },
      { decision: 'Hold TTL: 5 min vs 15 min', rationale: 'Short TTL keeps inventory recycling fast but punishes slow checkout (older buyers, accessibility needs). Long TTL gives buyers time but locks seats during abandonment. 8 minutes is the industry standard; some artists request 15 for accessibility. Make it configurable per event, not global.' },
      { decision: 'Dynamic pricing on vs off', rationale: 'On: captures money that would go to scalpers, reduces secondary-market spread. Off: stable prices, fewer angry headlines, less perceived gouging. Most platforms expose dynamic pricing as a per-event toggle controlled by the artist team, not a global default.' },
      { decision: 'Identity-bound tickets vs transferable tickets', rationale: 'Identity-bound (ID checked at venue): kills the secondary market but loses gifting and resale revenue. Transferable: customer-friendly but enables off-platform scalping. Hybrid: tickets are transferable inside the platform (verified resale) but not outside it, by binding the QR to the wallet at issuance.' },
      { decision: 'Synchronous payment vs queue and confirm', rationale: 'Synchronous: better UX for the 80% success case but PSP slowness blocks the user\'s thread. Queue-and-confirm: every payment is async, user sees "we will confirm shortly". Most on-sales use synchronous with a 3s timeout and async fallback; the worst UX is a long synchronous wait with no feedback.' },
    ],
    keyTakeaways: [
      'Hybrid inventory model: source-of-truth in Postgres, hot-path inventory in per-section Redis hashes with Lua CAS for atomic holds',
      'A two-stage flow (hold then buy) is essential when buyers choose specific items — but the hold layer becomes the hardest correctness problem in the system',
      'Bot mitigation is the dominant operational concern; account binding + presale codes + trust scoring + post-purchase verification are the four legs of the stool',
      'Section-level sharding gives you fine-grained scale-out without the round-trip cost of seat-level sharding',
      'Identity binding at issuance + verified resale is the only structural answer to off-platform scalping',
    ],
    faqs: [
      { question: 'How do you stop two users from buying the same seat?', answer: 'The HOLD operation is a Lua script that does atomic compare-and-set on the section\'s Redis hash: it reads the seat\'s status field, verifies it is AVAILABLE, and writes HELD:{hold_id} all in one server-side operation. Redis is single-threaded per shard, so the script runs to completion before any other client can touch the same hash field. Two concurrent HOLD attempts on the same seat: one wins atomically, the other reads HELD and returns a rejection.\n\nThe later CONVERT_TO_SOLD operation (at payment success) again uses CAS — it only flips HELD:{hold_id} to SOLD:{order_id} if the field still matches HELD:{hold_id}. So a hold that expired (releasing the seat to someone else) before payment completed cannot accidentally sell to the original holder. The customer is refunded and shown a friendly "your hold expired" message.' },
      { question: 'How does the virtual waiting room actually work — what does the user see?', answer: 'On the on-sale page just before the start time, the user clicks "join the queue". The edge worker:\n  1. Issues a signed session cookie.\n  2. ZADD waiting_room:{event_id} {now_ms} {session_id}.\n  3. Returns a page showing "you are #324,123 of 1,432,001" with an ETA.\n\nThe page polls the edge every ~5s for position updates (cheap — it\'s a single ZRANK on the cookie). When the admission service drains the queue and the user\'s session is admitted, the next poll redirects them to the live seat map with an admission JWT cookie. The seat APIs reject any request without a valid admission JWT, so anyone bypassing the queue UI still gets rejected.\n\nThe queue is per-event so different on-sales don\'t share contention. Per-region sub-queues are added for international tours to avoid one region\'s users being stuck behind another\'s.' },
      { question: 'Why bind tickets to identity? Isn\'t that hostile to gifting?', answer: 'Identity binding (the QR is only valid when presented by the buyer\'s wallet on a phone signed into the buyer\'s account) is the structural fix for off-platform scalping. Without it, tickets are bearer instruments that anyone can resell on third-party sites at any markup.\n\nGifting and legitimate resale are preserved via in-platform transfer: from the buyer\'s account, "transfer to" issues a new QR for the recipient and invalidates the old one. The platform sees and records every transfer.\n\nThe trade-off is real friction: the recipient must have an account and install the app. For most artists this is acceptable. For some (high-school musicals, family events) it\'s overbearing and the system should fall back to transferable QR. Make it a per-event toggle.' },
      { question: 'Why two different inventory layers (Redis section hashes and Postgres seats table)?', answer: 'Postgres is the source of truth at rest. It survives Redis failure, it integrates with analytics and reporting, it\'s where the seat catalogue lives. But Postgres can\'t do 200K hash-CAS ops/sec on a single record.\n\nRedis is the hot path during the on-sale. At sale open, the seat grid is hydrated from Postgres into Redis. Every hold and sale updates Redis. Every state change is also written to a Kafka event log (and reconciled into Postgres asynchronously). At sale close, a final reconciliation flushes Redis state into Postgres and the seats table becomes authoritative again.\n\nIf Redis dies mid-sale, the Kafka event log + last Postgres snapshot is enough to reconstruct state. A "sale paused" mode handles the gap. You never serve from a state that hasn\'t been confirmed durable.' },
      { question: 'What about presale codes — what stops bots from harvesting them?', answer: 'Three controls:\n  1. Codes are distributed via verified-account channels (artist mailing list to known accounts, premium card programs). Each code is bound to one account.\n  2. Codes have a per-code rate limit on attempts — a code used 100 times in 10 seconds is auto-revoked and the using accounts flagged.\n  3. Codes activate a "presale" admission tier in the waiting room — they don\'t bypass the queue, just enter a smaller, higher-trust queue with lower contention.\n\nThe goal isn\'t cryptographic secrecy of the code — codes leak, that\'s reality. The goal is making leaked codes worthless because the systems behind them limit how much each code can be used and how many tickets it can unlock.' },
      { question: 'What if the venue capacity changes after on-sale opens (added seats, reduced rows)?', answer: 'Two cases:\n  1. Adding seats — the operator inserts new rows into the seats table with status=AVAILABLE, runs a script that adds them to the Redis section hash, and the new seats appear in the seat map on the next refresh.\n  2. Removing seats — must only remove AVAILABLE seats; otherwise you\'re cancelling a buyer\'s purchase. The operator runs a script that does an atomic check (HSET only if AVAILABLE → REMOVED). Failed atomic checks indicate seats already held/sold, which require explicit cancellation flow with refunds.\n\nBoth operations write to the event log so analytics and reconciliation see the change. Mid-sale capacity changes are rare and operator-driven; they\'re never automated.' },
      { question: 'How do you handle a presale that\'s only for fans of a specific artist?', answer: 'Standard mechanism: the user must hold a "fan token" — a credential issued by the platform after some signal of fandom (verified purchase of past tickets to that artist, registration via the artist\'s site, a partnership with a streaming service). The fan token is a JWT in the account, scoped to artist or tour.\n\nDuring the presale window, the seat API requires both an admission JWT (from the waiting room) and a fan token JWT for the artist. Without both, requests are rejected with a "presale only" message.\n\nFan tokens are not used outside of presales — for the general on-sale, anyone with an admission JWT can buy. The token system is mostly fairness theatre against bots: a bot can still buy from a token-holding account, but it can\'t buy from arbitrary throwaway accounts.' },
      { question: 'What is "drop-out abandonment" and how do you handle it?', answer: 'When 2M people get admitted from the waiting room and 80% see they don\'t like the available seats and bail, the system has held 80% of inventory for 8 minutes and admitted a million people for nothing.\n\nMitigations:\n  • Show a few seat suggestions as the admission lands. Pre-filter by the user\'s declared preferences (price range, accessibility) so they\'re less likely to bail.\n  • Detect abandonment proactively — if a session is idle for >2 min after admission with no hold placed, release the admission JWT early and re-admit the next user in queue.\n  • Lock in commitment earlier — for premium events, require the user to declare ticket count and price tier before joining the queue. This makes the waiting room queue shorter for that pool and matches admissions to real demand.\n\nAbandonment is unavoidable but its rate is a metric you should observe and dampen.' },
      { question: 'Why does this need its own design? Couldn\'t we just use a hotel booking system?', answer: 'Three differences in workload:\n  1. Hotel: a few rooms × a long calendar = small per-item contention spread over many dates. Ticketmaster: one event\'s 50K seats compete for the same 60-second window.\n  2. Hotel: inventory is independent (room 5 on July 14 is unrelated to room 5 on July 15). Ticketmaster: all seats in a section share a hot key in the hot path.\n  3. Hotel: bot scalping pressure is moderate. Ticketmaster: on-sales are the largest organised bot events on the consumer internet.\n\nA hotel system\'s row-level locking is fine at hotel scale; at on-sale scale it would lock up. A flash-sale system\'s single-counter atomic inventory works for one SKU; at 50K distinct seats it would need 50K counters and a totally different addressing model. Ticketmaster\'s hybrid — per-section hashes with seat-level CAS — is the synthesis.' },
    ],
  },
];
