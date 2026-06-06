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
      { section: 'API Design', content: 'POST /shorten { longUrl, customAlias?, ttl? } → { shortUrl }\nGET /{shortCode} → 301 redirect to longUrl\nDELETE /{shortCode} (authenticated)' },
      { section: 'Short Code Generation', content: 'Base62-encode a 64-bit auto-increment ID from the database. This guarantees uniqueness without coordination overhead. 7 characters covers 62^7 ≈ 3.5 trillion URLs.' },
      { section: 'Database Schema', content: 'urls(short_code PK, long_url, user_id, created_at, expires_at). Use a relational DB (PostgreSQL) for ACID guarantees on writes.' },
      { section: 'Caching', content: 'Redis cache with LRU eviction sits in front of the DB for reads. Cache key = short_code, value = long_url. Cache hit ratio >80% given Zipf distribution of access.' },
      { section: 'Redirect Strategy', content: '301 (permanent) allows CDN and browser caching but loses click analytics. 302 (temporary) hits the origin every time but enables analytics. Use 302 for analytics; 301 for pure perf.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Web[Web App]
        Mobile[Mobile App]
        Bot[Bot or API Caller]
    end
    subgraph Edge
        direction TB
        CDN[CDN Edge Cache]
        LB[Load Balancer]
    end
    subgraph Gateway
        direction TB
        APIGW[API Gateway]
        Auth[Auth Service]
        RL[Rate Limiter]
    end
    subgraph Services
        direction TB
        Shorten[Shorten Service]
        Redirect[Redirect Service]
        Custom[Custom Alias Service]
        Analytics[Click Analytics Svc]
        Expire[Expiry Service]
        UserSvc[User Account Svc]
    end
    subgraph Async
        direction TB
        ClickQ[Click Event Queue]
        ClickW[Click Aggregator]
        ExpireJob[TTL Sweeper Job]
    end
    subgraph Storage
        direction TB
        IDGen[(ID Generator Base62)]
        URLDB[(URL Store PostgreSQL)]
        Cache[(Redis Hot URLs)]
        UserDB[(User DB)]
        ClickDB[(Click Counts DB)]
    end
    subgraph Analytics2 [Analytics]
        direction TB
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

    Web ~~~ CDN ~~~ APIGW ~~~ Shorten ~~~ ClickQ ~~~ IDGen

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class IDGen,URLDB,Cache,UserDB,ClickDB storage
    class ClickQ,ClickW,ExpireJob async
    class CDN,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: '301 vs 302 redirect', rationale: '301 allows browser caching for performance; 302 enables server-side analytics. Choose based on whether click tracking is needed.' },
      { decision: 'Base62 ID vs MD5 hash', rationale: 'Auto-increment Base62 has zero collision risk and shorter codes. MD5 requires collision checking but allows user-independent generation.' },
    ],
    keyTakeaways: ['Base62 encoding of auto-increment IDs is collision-free and compact', 'Redis caching absorbs the heavy read:write ratio', 'CDN can serve 301 redirects at the edge for lowest latency'],
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
      { section: 'Tweet Storage', content: 'Store tweets in a distributed DB (Cassandra) partitioned by user_id. Each row: tweet_id (Snowflake ID), user_id, content, created_at, media_urls. Snowflake IDs are 64-bit integers composed of a millisecond timestamp, datacenter ID, and sequence number — they are globally unique and time-sortable, which means range queries by recency are efficient without a separate timestamp index. (See the Distributed ID Generator design for full details.)' },
      { section: 'Timeline Generation — Fan-out on Write', content: 'When a user tweets, push the tweet_id into a Redis sorted set (timeline cache) for each follower. Score = timestamp. Works well for non-celebrity users.' },
      { section: 'Celebrity Problem', content: 'For users with >1M followers, fan-out on write is too expensive (writing to 1M sets per tweet). Instead use fan-out on read: merge celebrity tweets at read time with the pre-built feed.' },
      { section: 'Timeline Read Path', content: 'Fetch pre-built timeline from Redis (ZREVRANGE by score). Merge in latest tweets from any celebrities the user follows. Hydrate tweet_ids into full tweet objects via a Tweet Service.' },
      { section: 'Media Handling', content: 'Images/videos go to blob storage (S3). URLs stored with tweet. CDN serves media. Thumbnail generation is async via a queue.' },
      { section: 'Observability', content: 'Key metrics: tweet write latency P99, timeline read latency P99, fan-out queue depth (alert if >1M backlog), cache hit ratio (alert if <70%). Distributed tracing (Jaeger/Zipkin) on the tweet-write and feed-read paths. Dashboard: tweets/sec, active WebSocket connections, Redis memory utilization.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Web[Web App]
        Mobile[Mobile App]
    end
    subgraph Gateway
        direction TB
        APIGW[API Gateway]
        Auth[Auth Service]
        RL[Rate Limiter]
    end
    subgraph Services
        direction TB
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
        direction TB
        FanoutQ[Fan-out Queue]
        FanoutW[Fan-out Workers]
        MediaProc[Media Processor]
        Indexer[Search Indexer]
        TrendsJob[Trends Aggregator]
    end
    subgraph Storage
        direction TB
        TweetDB[(Tweets Cassandra)]
        TLCache[(Timeline Cache Redis)]
        GraphDB[(Follow Graph DB)]
        UserDB[(User DB)]
        ES[(Elasticsearch)]
        DMDB[(DM Cassandra)]
        MediaS3[(Media S3 and CDN)]
    end
    subgraph Analytics
        direction TB
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

    Web ~~~ APIGW ~~~ Tweet ~~~ FanoutQ ~~~ TweetDB ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class TweetDB,TLCache,GraphDB,UserDB,ES,DMDB,MediaS3 storage
    class FanoutQ,FanoutW,MediaProc,Indexer,TrendsJob async
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Fan-out on write vs read', rationale: 'Fan-out on write gives fast reads but is expensive for celebrities. Hybrid approach: fan-out on write for regular users, fan-out on read for celebrities.' },
    ],
    keyTakeaways: ['Hybrid fan-out strategy handles the celebrity follower skew', 'Snowflake IDs provide globally unique, time-ordered tweet IDs', 'Redis sorted sets are ideal for ranked timeline caches'],
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
      { section: 'Photo Upload Flow', content: 'Client gets a presigned S3 URL from the API. Client uploads directly to S3 (bypasses API servers). S3 triggers a Lambda/queue event for post-processing (thumbnails, compression).' },
      { section: 'Media Storage', content: 'Original images in S3. Multiple resized versions (thumbnail, feed, full) generated asynchronously and stored in separate S3 prefixes. All served via CloudFront CDN.' },
      { section: 'Feed Generation', content: 'Same hybrid fan-out strategy as Twitter. Store pre-computed feed in Redis (sorted set of post IDs by timestamp). Merge celebrity posts at read time.' },
      { section: 'Social Graph', content: 'Store follower/following relationships in a dedicated graph store or a separate relational table follows(follower_id, followee_id). Indexed on both columns.' },
      { section: 'Post Metadata', content: 'Store in Cassandra: post_id, user_id, s3_url, caption, created_at, like_count, comment_count. Like counts use Redis counters flushed to DB periodically.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Web[Web App]
        Mobile[Mobile App]
    end
    subgraph Edge
        direction TB
        CDN[CloudFront CDN]
    end
    subgraph Gateway
        direction TB
        APIGW[API Gateway]
        Auth[Auth Service]
    end
    subgraph Services
        direction TB
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
        direction TB
        SQS[SQS Queue]
        ImgProc[Image Processor]
        VidProc[Video Transcoder]
        FanoutW[Feed Fan-out Worker]
        Indexer[Search Indexer]
        Counter[Like Counter Flusher]
    end
    subgraph Storage
        direction TB
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
        direction TB
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

    Web ~~~ CDN ~~~ APIGW ~~~ UploadSvc ~~~ SQS ~~~ S3 ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class S3,PostDB,FeedCache,GraphDB,LikeRedis,CommentDB,UserDB,ES storage
    class SQS,ImgProc,VidProc,FanoutW,Indexer,Counter async
    class CDN edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Direct S3 upload vs proxy through API', rationale: 'Direct upload via presigned URL offloads bandwidth from API servers and is faster for clients. Trade-off: less control over validation mid-upload.' },
    ],
    keyTakeaways: ['Presigned S3 URLs allow clients to upload directly, saving API server bandwidth', 'Async image processing via queues keeps the upload API fast', 'CDN is essential for petabyte-scale media delivery'],
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
      { section: 'Token Bucket Algorithm', content: 'Each user has a bucket of tokens. Tokens refill at a fixed rate. Each request consumes one token. Allows bursts up to bucket capacity. Implemented with Redis: store (tokens, last_refill_time) per user.' },
      { section: 'Sliding Window Log', content: 'Store a sorted set of timestamps per user in Redis. On each request, remove timestamps older than the window, count remaining, compare to limit. Accurate but memory-intensive.' },
      { section: 'Fixed Window Counter', content: 'Simplest: INCR a Redis key named user:{id}:window:{minute}. Set TTL = window size. Fast but allows 2× burst at window boundaries.' },
      { section: 'Distributed Coordination', content: 'Use Redis as the shared state store across all API servers. Redis INCR is atomic. For high throughput, use local in-process counters with periodic sync to Redis (eventual consistency).' },
      { section: 'Response Headers', content: 'Always return X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset in response headers so clients can self-throttle.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Web[Web Client]
        Mobile[Mobile Client]
        API3rd[Third Party API Caller]
    end
    subgraph Edge
        direction TB
        LB[Load Balancer]
    end
    subgraph Gateway
        direction TB
        APIGW[API Gateway]
        Middleware[Rate Limit Middleware]
        AuthSvc[Auth Service]
    end
    subgraph Services
        direction TB
        TokenBucket[Token Bucket Algo]
        SlidingLog[Sliding Window Log Algo]
        FixedWin[Fixed Window Counter Algo]
        ConfigSvc[Limit Config Service]
        Handler[Request Handler]
        Deny[429 Response Builder]
        Headers[Rate Limit Header Injector]
    end
    subgraph Async
        direction TB
        SyncJob[Local to Central Sync Job]
        LogShipper[Decision Log Shipper]
    end
    subgraph Storage
        direction TB
        RedisCluster[(Redis Cluster Shared State)]
        LocalCache[(Local In-Process Counter)]
        ConfigDB[(Limit Config DB)]
    end
    subgraph Analytics
        direction TB
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

    Web ~~~ LB ~~~ APIGW ~~~ TokenBucket ~~~ SyncJob ~~~ RedisCluster ~~~ Kafka

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class RedisCluster,LocalCache,ConfigDB storage
    class SyncJob,LogShipper async
    class LB edge
    class Kafka,Lake analytics`,
    tradeoffs: [
      { decision: 'Token bucket vs fixed window', rationale: 'Token bucket handles bursts gracefully and is more user-friendly. Fixed window is simpler but allows 2× burst at window edges.' },
      { decision: 'Centralized Redis vs local counters', rationale: 'Centralized Redis is accurate but adds latency. Local counters are faster but may allow slight over-limit under high concurrency.' },
    ],
    keyTakeaways: ['Token bucket is the most user-friendly algorithm, handling bursts without harsh cutoffs', 'Redis atomic INCR makes distributed rate limiting straightforward', 'Always include rate limit headers so clients can back off gracefully'],
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
      { section: 'Request Pipeline', content: 'Each request passes through: SSL termination → Auth middleware → Rate limiter → Router → Load balancer → Backend service. Each step is a composable plugin.' },
      { section: 'Authentication', content: 'Validate JWT signature using cached public keys (no DB call per request). Cache public keys with TTL. For API keys, maintain an in-memory hash set refreshed from Redis.' },
      { section: 'Service Discovery & Routing', content: 'Route table maps URL patterns to backend service pools. Updated dynamically from a service registry (Consul/etcd). Gateway subscribes to change events.' },
      { section: 'Load Balancing', content: 'Round-robin or least-connections across healthy instances. Health checks run every 5s. Unhealthy instances removed from rotation immediately.' },
      { section: 'Observability', content: 'Every request logs: latency, status code, client_id, route. Emit to a centralized logging pipeline (Kafka → Elasticsearch). Prometheus metrics scraped per gateway instance.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Web[Web App]
        Mobile[Mobile App]
        Partner[Partner Service]
    end
    subgraph Edge
        direction TB
        TLS[SSL TLS Termination]
        LB[Global Load Balancer]
    end
    subgraph Gateway [Gateway Pipeline]
        direction TB
        GW[API Gateway Cluster]
        AuthMW[JWT and API Key Auth]
        RLMW[Rate Limiter Middleware]
        Router[Service Router]
        LBMW[Per-Service Load Balancer]
        TransformMW[Req and Resp Transformer]
    end
    subgraph Services
        direction TB
        AuthSvc[Auth Service]
        SvcA[Service A]
        SvcB[Service B]
        SvcC[Service C]
        Health[Health Check Service]
    end
    subgraph Async
        direction TB
        LogShipper[Log Shipper]
        MetricsAgg[Metrics Aggregator]
    end
    subgraph Storage
        direction TB
        Registry[(Service Registry Consul)]
        RLRedis[(Rate Limit Redis)]
        KeyCache[(JWT Public Key Cache)]
        ConfigDB[(Routing Config)]
    end
    subgraph Analytics
        direction TB
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

    Web ~~~ TLS ~~~ GW ~~~ AuthSvc ~~~ LogShipper ~~~ Registry ~~~ Kafka

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class Registry,RLRedis,KeyCache,ConfigDB storage
    class LogShipper,MetricsAgg async
    class TLS,LB edge
    class Kafka,ELK,Prom,Grafana analytics`,
    tradeoffs: [
      { decision: 'Gateway validates JWT vs dedicated auth sidecar', rationale: 'In-gateway validation is faster (no network hop) but ties auth logic to the gateway. Sidecar keeps separation of concerns but adds latency.' },
    ],
    keyTakeaways: ['API gateway centralizes cross-cutting concerns (auth, rate limit, logging)', 'Cache JWT public keys in-process to avoid per-request auth service calls', 'Service registry enables dynamic routing without gateway restarts'],
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
      { section: 'Upload Pipeline', content: 'Client uploads to nearest edge server (pre-signed URL). Edge relays to origin blob storage (S3). An event triggers a transcoding job queue (SQS/Kafka). Transcoder workers pick jobs and produce multiple resolution variants.' },
      { section: 'Transcoding', content: 'Split video into 2-second segments (MPEG-DASH / HLS). Transcode each segment in parallel across a worker fleet. Output: a manifest file (.m3u8) and segment files at each resolution. Store in S3.' },
      { section: 'Adaptive Bitrate Streaming', content: 'Client player downloads the manifest and starts with a low resolution. Based on measured bandwidth, it dynamically selects higher or lower quality segment files. Eliminates buffering on poor connections.' },
      { section: 'CDN Distribution', content: 'Segment files pushed/cached at CDN edge nodes globally. First viewer in a region triggers a cache fill. Subsequent viewers served from edge with <5ms latency.' },
      { section: 'Metadata & Search', content: 'Video metadata (title, description, tags, view count) stored in Cassandra. Full-text search via Elasticsearch. View counts use Redis counters flushed to DB asynchronously.' },
      { section: 'Observability', content: 'Key metrics: transcoding job queue depth and P99 processing time, CDN cache hit ratio per region (alert if <85%), playback error rate, buffering ratio per bitrate tier. Alerts: transcoding worker failures, CDN origin error spikes. Use a metrics pipeline (Prometheus → Grafana) and structured logs (ELK stack) for upload and playback events.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Web[Web Player]
        Mobile[Mobile App]
        TV[TV / Console]
    end
    subgraph Edge
        direction TB
        GeoDNS[Geo-DNS]
        CDN[CDN Edge PoPs]
        EdgeUp[Edge Upload Servers]
    end
    subgraph Gateway
        direction TB
        APIGW[API Gateway]
        Auth[Auth and OAuth]
    end
    subgraph Services
        direction TB
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
        direction TB
        TQ[Transcoding Queue]
        Workers[Transcoder Workers]
        Thumbs[Thumbnail Generator]
        CID[Content ID Scanner]
        Trainer[Rec Model Training]
    end
    subgraph Storage
        direction TB
        Raw[(Raw Video S3)]
        Enc[(Encoded Segments and HLS Manifests)]
        MetaDB[(Video Metadata Cassandra)]
        ES[(Elasticsearch)]
        Counter[(Redis View Counter)]
        CommentDB[(Comments DB)]
        UserDB[(User and Subs DB)]
    end
    subgraph Analytics
        direction TB
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

    Web ~~~ GeoDNS ~~~ APIGW ~~~ Upload ~~~ TQ ~~~ Raw ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class Raw,Enc,MetaDB,ES,Counter,CommentDB,UserDB storage
    class TQ,Workers,Thumbs,CID,Trainer async
    class GeoDNS,CDN,EdgeUp edge
    class EventBus,Lake,Feature analytics`,
    tradeoffs: [
      { decision: 'Pre-split vs on-the-fly transcoding', rationale: 'Pre-transcoding all resolutions costs storage but guarantees instant playback. On-the-fly transcoding saves storage but adds latency and requires powerful edge servers.' },
    ],
    keyTakeaways: ['HLS/DASH adaptive bitrate eliminates buffering by matching quality to bandwidth', 'Parallel segment transcoding scales video processing horizontally', 'CDN edge caching is essential — most views hit cache, not origin'],
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
      { section: 'DNS-Based Geo-Routing', content: 'When client resolves CDN domain, the authoritative DNS server returns the IP of the nearest edge PoP (based on client IP geolocation or Anycast routing). Anycast assigns the same IP to multiple PoPs; BGP routes to the nearest one.' },
      { section: 'Cache Hierarchy', content: 'Two-tier: edge PoPs (L1 cache, small SSD) and regional mid-tier clusters (L2 cache, large HDD). Edge miss → mid-tier → origin. This reduces origin load dramatically for long-tail content.' },
      { section: 'Cache Key & TTL', content: 'Cache key = URL + Vary headers (e.g., Accept-Encoding). TTL set by origin via Cache-Control headers. CDN respects s-maxage for shared caches. Default TTL for images: 30 days; for HTML: 60s.' },
      { section: 'Content Invalidation', content: 'Origin sends purge API calls to CDN control plane. Control plane propagates invalidation to all edge nodes (gossip protocol or pub-sub). Stale objects evicted on next request.' },
      { section: 'TLS Termination', content: 'TLS terminated at edge. Each PoP has the TLS certificate. Reduces TLS handshake RTT from ~150ms (origin) to <20ms (local edge). OCSP stapling avoids revocation lookups.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Browser[Browser]
        MobileApp[Mobile App]
        VideoPlayer[Video Player]
    end
    subgraph Edge
        direction TB
        GeoDNS[Geo-DNS Anycast]
        EdgePoP[Edge PoP L1 Cache]
        TLS[TLS Termination at Edge]
        WAF[WAF and DDoS Shield]
    end
    subgraph Services
        direction TB
        MidTier[Mid-tier Regional Cache L2]
        PurgeAPI[Purge and Invalidate API]
        Control[Control Plane]
        OCSP[OCSP Stapling Service]
    end
    subgraph Async
        direction TB
        Gossip[Invalidation Gossip]
        LogAgg[Edge Log Aggregator]
        PrefetchJob[Prefetch and Prewarm Job]
    end
    subgraph Storage
        direction TB
        EdgeSSD[(Edge SSD Cache)]
        MidHDD[(Mid-tier HDD Cache)]
        Origin[(Origin Server)]
        CertStore[(TLS Cert Store)]
    end
    subgraph Analytics
        direction TB
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

    Browser ~~~ GeoDNS ~~~ MidTier ~~~ Gossip ~~~ EdgeSSD ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class EdgeSSD,MidHDD,Origin,CertStore storage
    class Gossip,LogAgg,PrefetchJob async
    class GeoDNS,EdgePoP,TLS,WAF edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Anycast vs DNS-based routing', rationale: 'Anycast is faster (no extra DNS round trip) and handles failover via BGP. DNS-based routing is simpler to deploy and allows finer geographic control.' },
    ],
    keyTakeaways: ['Two-tier cache hierarchy shields the origin from long-tail traffic', 'Anycast + BGP provides automatic failover without extra DNS TTL delays', 'TLS termination at edge reduces handshake latency for global users'],
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
      { section: 'Open Connect CDN', content: 'Netflix operates its own CDN (Open Connect). ISPs host Netflix appliances in their networks. Video is pre-positioned on local ISP hardware during off-peak hours, minimizing internet transit costs.' },
      { section: 'Encoding Pipeline', content: 'Each title encoded into 1,000+ variants: every combination of resolution (144p–4K), codec (H.264, H.265, AV1), and bitrate. AV1 offers 30% better compression than H.265. Per-scene encoding adjusts bitrate based on scene complexity.' },
      { section: 'Adaptive Streaming', content: 'Client player evaluates bandwidth every few seconds and selects the appropriate bitrate variant. Netflix uses a proprietary algorithm (BOLA) for buffer-based adaptation.' },
      { section: 'Recommendation Engine', content: 'Collaborative filtering on viewing history. A/B tested constantly. Model trained offline on Spark, served online via a feature store. Thumbnail personalization: different users see different cover images for the same show.' },
      { section: 'Playback State', content: 'Resume position stored in Cassandra keyed by (user_id, content_id). Synced across devices. Last write wins for concurrent sessions.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        TV[TV App]
        Mobile[Mobile App]
        Web[Web Player]
    end
    subgraph Edge
        direction TB
        GeoDNS[Geo-DNS]
        OC[Open Connect ISP Appliances]
        Origin[Origin CDN Tier]
    end
    subgraph Gateway
        direction TB
        APIGW[API Gateway]
        Auth[Auth and Profile Svc]
    end
    subgraph Services
        direction TB
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
        direction TB
        EncQ[Encoding Queue]
        Encoder[Per-Scene Encoder H264 H265 AV1]
        ThumbGen[Thumbnail Variant Generator]
        RecTrain[Rec Model Spark Training]
        Prepos[Pre-positioning Job]
    end
    subgraph Storage
        direction TB
        Master[(Mezzanine Masters S3)]
        Variants[(Encoded Variants S3)]
        CatDB[(Catalog DB)]
        ES[(Elasticsearch)]
        ViewState[(View State Cassandra)]
        UserDB[(User and Profile DB)]
        BillDB[(Subscriptions DB)]
    end
    subgraph Analytics
        direction TB
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

    TV ~~~ GeoDNS ~~~ APIGW ~~~ Catalog ~~~ EncQ ~~~ Master ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class Master,Variants,CatDB,ES,ViewState,UserDB,BillDB storage
    class EncQ,Encoder,ThumbGen,RecTrain,Prepos async
    class GeoDNS,OC,Origin edge
    class EventBus,Lake,Feature analytics`,
    tradeoffs: [
      { decision: 'Own CDN vs third-party', rationale: 'Operating Open Connect is expensive upfront but saves billions in transit costs at Netflix scale. Third-party CDNs (Akamai, Cloudflare) are better for smaller platforms.' },
    ],
    keyTakeaways: ['Per-scene adaptive bitrate encoding achieves better quality at same bandwidth', 'Pre-positioning content on ISP hardware eliminates internet transit at peak hours', 'Cassandra is well-suited for playback state: high write throughput, simple key lookups'],
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
      { section: 'Consistent Hashing for Partitioning', content: 'Map key space onto a ring. Each node is assigned multiple virtual nodes on the ring (150+ per physical node). A key is owned by the first N clockwise nodes for replication factor N. Adding/removing nodes only remaps ~1/N of keys.' },
      { section: 'Replication & Quorum', content: 'Each key replicated to N nodes (typically N=3). Write quorum W=2, Read quorum R=2. W + R > N ensures at least one node has the latest write on every read (sloppy quorum). Tunable for availability vs consistency.' },
      { section: 'Storage Engine — LSM Tree', content: 'Writes go to an in-memory MemTable and append-only WAL (Write-Ahead Log). MemTable flushed to SSTable files on disk when full. SSTables compacted in background (merge sort). Provides fast writes; reads may check multiple SSTables (Bloom filters reduce I/O).' },
      { section: 'Conflict Resolution', content: 'Use vector clocks to detect concurrent writes. A vector clock is a per-node counter map (e.g., {A:2, B:1}) stored with each value. When node A writes, it increments its own counter. If two versions have incomparable clocks (neither dominates the other), they were written concurrently — a true conflict. On conflict, use last-write-wins (timestamp) or return both versions to the client for application-level resolution (DynamoDB shopping-cart pattern).' },
      { section: 'Failure Handling', content: 'Hinted handoff: if a node is temporarily down, another node stores writes with a hint to forward later. Anti-entropy (Merkle tree comparison) detects and repairs diverged replicas in the background.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        App[Application Client]
        SDK[KV SDK]
    end
    subgraph Gateway
        direction TB
        LB[Load Balancer]
        Coord[Coordinator Node]
    end
    subgraph Services
        direction TB
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
        direction TB
        Hinted[Hinted Handoff Queue]
        AntiEntropy[Merkle Anti-Entropy Job]
        Compaction[SSTable Compaction]
        TTLSweeper[TTL Sweeper]
    end
    subgraph Storage
        direction TB
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

    App ~~~ LB ~~~ Ring ~~~ Hinted ~~~ MemTable

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    class MemTable,WAL,SSTable,Bloom,HintStore,MetaDB storage
    class Hinted,AntiEntropy,Compaction,TTLSweeper async
    class LB edge`,
    tradeoffs: [
      { decision: 'LSM tree vs B-tree storage', rationale: 'LSM optimizes for write throughput (sequential disk I/O). B-trees are better for read-heavy workloads. Key-value stores typically favor writes, making LSM the standard choice.' },
      { decision: 'Strong vs eventual consistency', rationale: 'Strong consistency (R+W > N) increases latency and reduces availability. Eventual consistency is preferred when availability matters more than strict correctness.' },
    ],
    keyTakeaways: ['Consistent hashing minimizes key remapping when nodes join/leave', 'LSM trees provide high write throughput via sequential disk writes', 'Vector clocks detect concurrent updates; Merkle trees efficiently identify diverged replicas'],
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
      { section: 'File Chunking', content: 'Split files into 4MB chunks before upload. Each chunk identified by its SHA-256 hash. If a chunk already exists (deduplication), skip uploading it. Delta sync: on file change, only upload modified chunks.' },
      { section: 'Metadata Service', content: 'Store file metadata in a relational DB (PostgreSQL): file_id, user_id, name, parent_folder_id, chunk_ids[], version, created_at, modified_at. Separate from blob storage.' },
      { section: 'Sync Protocol', content: 'Client maintains a local DB of file states. On startup, fetches server state and reconciles. Long-polling or WebSocket connection notifies clients of remote changes in real-time. Client sends file_hash; server responds with which chunks are missing.' },
      { section: 'Conflict Resolution', content: 'If two clients modify the same file offline, detect conflict via version vectors. Create a conflict copy ("File (conflict copy, 2024-01-01)"). No automatic merge — user resolves.' },
      { section: 'Versioning', content: 'Each upload creates a new version row. Store all chunk references per version. Revert = swap the active version pointer. Storage cost = only unique chunks across all versions (dedup).' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Desktop[Desktop Sync Client]
        Mobile[Mobile App]
        WebUI[Web UI]
    end
    subgraph Edge
        direction TB
        CDN[CDN for Downloads]
        LB[Load Balancer]
    end
    subgraph Gateway
        direction TB
        APIGW[API Gateway]
        Auth[Auth Service]
    end
    subgraph Services
        direction TB
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
        direction TB
        DedupQ[Dedup Hash Lookup]
        ThumbGen[Thumbnail and Preview Gen]
        Indexer[Search Indexer]
        VirusScan[Antivirus Scanner]
        TrashGC[Trash Garbage Collector]
    end
    subgraph Storage
        direction TB
        ChunkStore[(Chunk Blob Store S3)]
        MetaDB[(Metadata DB PostgreSQL)]
        ChunkIndex[(Chunk Hash Index)]
        VersionDB[(Version History DB)]
        ACLDB[(Sharing ACL DB)]
        ES[(Elasticsearch)]
    end
    subgraph Analytics
        direction TB
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

    Desktop ~~~ CDN ~~~ APIGW ~~~ UploadSvc ~~~ DedupQ ~~~ ChunkStore ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class ChunkStore,MetaDB,ChunkIndex,VersionDB,ACLDB,ES storage
    class DedupQ,ThumbGen,Indexer,VirusScan,TrashGC async
    class CDN,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Block-level dedup vs file-level dedup', rationale: 'Block-level dedup (chunk hashing) saves far more space for files with minor edits. File-level dedup only catches identical files. Block-level is standard.' },
    ],
    keyTakeaways: ['Content-addressed chunking enables deduplication and efficient delta sync', 'Version history costs minimal extra storage when chunks are deduplicated', 'Conflict copies are safer than automatic merge for binary files'],
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
      { section: 'Sharding with Consistent Hashing', content: 'Distribute keys across nodes using a consistent hash ring. Each node owns a portion of the key space. Adding a node only migrates ~1/N of keys. Virtual nodes (vnodes) balance load.' },
      { section: 'Replication', content: 'Primary-replica topology per shard. Writes go to primary, async replicated to replicas. Reads can be served from replicas (slightly stale) or primary (always fresh). Failover: replica promoted if primary is unreachable for >5s.' },
      { section: 'Eviction Policies', content: 'LRU (Least Recently Used): evict the least-recently accessed key when memory is full. LFU (Least Frequently Used): evict the key accessed fewest times. allkeys-lru is the most common production choice.' },
      { section: 'Cache Aside Pattern', content: 'Application code reads from cache. On miss, reads from DB and populates cache with a TTL. On write, application writes to DB and either invalidates the cache key or updates it (write-through).' },
      { section: 'Thundering Herd Prevention', content: 'When a hot key expires, many requests simultaneously miss and hit the DB. Mitigations: (1) Add random jitter to TTLs. (2) Use mutex/lock for the first request to repopulate; others wait. (3) Background refresh before expiry.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        AppA[App Server A]
        AppB[App Server B]
        Worker[Background Worker]
    end
    subgraph Gateway
        direction TB
        Proxy[Smart Client SDK]
        HashRing[Consistent Hash Router]
    end
    subgraph Services
        direction TB
        Shard1Primary[Shard 1 Primary]
        Shard1Replica[Shard 1 Replica]
        Shard2Primary[Shard 2 Primary]
        Shard2Replica[Shard 2 Replica]
        ShardN[Shard N Primary]
        Sentinel[Sentinel Failover Monitor]
        Mutex[Stampede Mutex Lock]
    end
    subgraph Async
        direction TB
        EvictLRU[LRU Eviction Task]
        Repl[Async Replication Stream]
        TTLExpire[TTL Expiration Sweep]
        WarmJob[Cache Warmer]
        RefreshAhead[Background Refresh]
    end
    subgraph Storage
        direction TB
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

    AppA ~~~ Proxy ~~~ Shard1Primary ~~~ EvictLRU ~~~ Mem1

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    class Mem1,Mem2,MemN,DB,AOF,Snapshot storage
    class EvictLRU,Repl,TTLExpire,WarmJob,RefreshAhead async`,
    tradeoffs: [
      { decision: 'Cache aside vs write-through', rationale: 'Cache aside is simple and avoids caching data that is never read. Write-through always keeps cache warm but wastes memory on write-heavy data that is rarely read.' },
    ],
    keyTakeaways: ['Consistent hashing enables online node addition/removal with minimal key migration', 'LRU eviction with random TTL jitter prevents cache stampedes', 'Primary-replica topology provides read scalability and automatic failover'],
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
      { section: 'Range-Based Sharding', content: 'Data split into ranges (tablets) of ~64MB each. Each range has 3 replicas stored on different nodes. A distributed metadata layer (similar to BigTable\'s METADATA table) maps key ranges to node locations.' },
      { section: 'Consensus with Raft', content: 'Each range has a Raft group of 3 replicas. Writes go to the Raft leader, which replicates to followers before committing. If leader fails, Raft elects a new leader in <2s without data loss.' },
      { section: 'Distributed Transactions', content: 'Two-phase commit (2PC) coordinated by the transaction coordinator. To avoid coordinator SPOF, coordinator state stored in Raft. Optimistic concurrency: reads don\'t lock; conflicts detected at commit.' },
      { section: 'Time Synchronization (TrueTime)', content: 'Spanner uses GPS+atomic clock (TrueTime) to assign globally ordered timestamps. CockroachDB uses HLC (Hybrid Logical Clocks) to approximate this without specialized hardware. Ensures cross-shard transaction ordering.' },
      { section: 'SQL Layer', content: 'SQL queries parsed and optimized into a distributed execution plan. The optimizer pushes predicates to the storage layer to minimize data transfer. Joins across shards use a distributed hash join or broadcast join.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        AppClient[App Client]
        SQLDriver[SQL Driver]
        AnalyticsClient[Analytics Client]
    end
    subgraph Gateway
        direction TB
        LB[Load Balancer]
        SQLLayer[SQL Parser and Optimizer]
        Planner[Distributed Plan Executor]
    end
    subgraph Services
        direction TB
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
        direction TB
        Rebalancer[Range Rebalancer]
        Splitter[Range Splitter 64MB]
        Backup[Incremental Backup Job]
        GC[MVCC Garbage Collector]
        ReplLag[Replica Catch-up Worker]
    end
    subgraph Storage
        direction TB
        RaftLog[(Raft Log)]
        RocksDB[(RocksDB Range Store)]
        MetaDB[(Range Metadata Table)]
        BackupBlob[(Backup Object Store)]
        CDCStream[(CDC Change Stream)]
    end
    subgraph Analytics
        direction TB
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

    AppClient ~~~ LB ~~~ TxCoord ~~~ Rebalancer ~~~ RaftLog ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class RaftLog,RocksDB,MetaDB,BackupBlob,CDCStream storage
    class Rebalancer,Splitter,Backup,GC,ReplLag async
    class LB edge
    class EventBus,Warehouse analytics`,
    tradeoffs: [
      { decision: 'Raft vs Paxos', rationale: 'Raft is easier to understand and implement correctly. Paxos has better-studied theoretical properties but harder to implement. Most modern systems choose Raft.' },
    ],
    keyTakeaways: ['Raft consensus ensures each data range is strongly consistent without manual failover', 'Hybrid logical clocks enable cross-shard transaction ordering without GPS hardware', '2PC across shards is unavoidable for ACID but requires careful coordinator failure handling'],
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
      { section: 'Event Ingestion', content: 'Services emit events to a Kafka topic (e.g., "user.purchase", "friend.request"). The notification service consumes events, looks up user preferences, and routes to the appropriate channel.' },
      { section: 'Channel Workers', content: 'Separate worker pools per channel (push, email, SMS). Each worker dequeues from a channel-specific queue, formats the message using a template, and calls the provider API (FCM, SES, Twilio).' },
      { section: 'Retry & Idempotency', content: 'On provider failure, exponential backoff retry (up to 3× with jitter). Each notification has a UUID stored in a DB table. Before sending, check if UUID already delivered (idempotency key) to prevent duplicates after retries.' },
      { section: 'User Preferences', content: 'Users store preferences in a NoSQL store: { userId, channel: { push: true, email: false }, types: { marketing: false, transactional: true } }. Checked before every send.' },
      { section: 'Rate Limiting per User', content: 'Apply per-user per-channel rate limits (e.g., max 5 marketing emails/week) using a Redis counter. Suppress excess notifications with a priority queue — high-priority (transactional) notifications always go through.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Mobile[Mobile App]
        Web[Web App]
        EmailInbox[Email Inbox]
        Phone[SMS Phone]
    end
    subgraph Edge
        direction TB
        APNs[APNs and FCM Gateway]
    end
    subgraph Gateway
        direction TB
        APIGW[Notification API]
        Auth[Auth Service]
    end
    subgraph Services
        direction TB
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
        direction TB
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
        direction TB
        FCM[FCM and APNs]
        SES[AWS SES SendGrid]
        Twilio[Twilio SMS]
    end
    subgraph Storage
        direction TB
        PrefDB[(Preferences DB)]
        TemplateDB[(Templates DB)]
        IdempDB[(Idempotency Keys)]
        RLRedis[(Rate Limit Redis)]
        ReceiptDB[(Delivery Receipts)]
    end
    subgraph Analytics
        direction TB
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

    Mobile ~~~ APNs ~~~ APIGW ~~~ EventConsumer ~~~ Kafka ~~~ PrefDB ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class PrefDB,TemplateDB,IdempDB,RLRedis,ReceiptDB storage
    class Kafka,PushQ,EmailQ,SMSQ,PushWorker,EmailWorker,SMSWorker,RetryQ,DLQ async
    class APNs edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Direct API call vs queue-based workers', rationale: 'Queue-based workers decouple notification production from delivery, enabling independent scaling, retry logic, and backpressure handling without blocking event producers.' },
    ],
    keyTakeaways: ['Kafka decouples event producers from the notification system', 'Channel-specific worker pools scale independently based on volume', 'Idempotency keys prevent duplicate sends after retry'],
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
      { section: 'Message Storage', content: 'Use a distributed, partitioned log (like Kafka) as the backing store. Each topic partition is an ordered, immutable sequence of messages stored on disk. Multiple partitions per topic enable parallel consumption.' },
      { section: 'Publishing', content: 'Publisher sends message to the Pub/Sub API. API appends to the appropriate topic partition (round-robin or by message key). Returns an acknowledgment with a message ID once durably written to the log.' },
      { section: 'Subscriptions & Delivery', content: 'Each subscription tracks an offset per partition. The broker pushes messages to subscribers (push model) or subscribers poll (pull model). Pull model is preferred for backpressure control.' },
      { section: 'Acknowledgment & Retry', content: 'Subscriber sends ACK with message ID. Broker advances the offset. If no ACK within ackDeadline (e.g., 30s), message is redelivered to another subscriber. After N retries, message goes to a Dead Letter Queue (DLQ).' },
      { section: 'Fan-out', content: 'Multiple subscriptions on one topic each get an independent cursor on the same underlying log. No data is duplicated — just the offset pointer is maintained per subscription.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Pub1[Publisher A]
        Pub2[Publisher B]
        Sub1[Subscriber Service A]
        Sub2[Subscriber Service B]
        SubPush[Push Subscriber Webhook]
    end
    subgraph Gateway
        direction TB
        APIGW[Pub Sub API]
        AuthZ[Authn and IAM]
        AdminAPI[Admin API Topics and Subs]
    end
    subgraph Services
        direction TB
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
        direction TB
        P1[Partition 1 Log]
        P2[Partition 2 Log]
        P3[Partition 3 Log]
        Retry[Redelivery Scheduler]
        RetentionGC[Retention GC 7 days]
    end
    subgraph Storage
        direction TB
        LogStore[(Distributed Log Disk)]
        OffsetStore[(Subscription Offsets)]
        TopicMeta[(Topic and Sub Registry)]
        DLQStore[(Dead Letter Queue)]
    end
    subgraph Analytics
        direction TB
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

    Pub1 ~~~ APIGW ~~~ Publisher ~~~ P1 ~~~ LogStore ~~~ Metrics

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class LogStore,OffsetStore,TopicMeta,DLQStore storage
    class P1,P2,P3,Retry,RetentionGC async
    class Metrics,Lake analytics`,
    tradeoffs: [
      { decision: 'Push vs pull delivery', rationale: 'Push is lower latency. Pull allows subscribers to control their consumption rate (backpressure), which is critical for slow consumers or bursty workloads.' },
    ],
    keyTakeaways: ['A distributed log (immutable, partitioned) is the ideal storage layer for pub/sub', 'Multiple subscriptions share one log — only offsets differ, no data duplication', 'Dead letter queues are essential for handling poison messages gracefully'],
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
      { section: 'Topics and Partitions', content: 'Each topic is split into N partitions. A partition is an ordered, append-only log stored on broker disk. Messages within a partition are ordered by offset. Partitions enable parallel read/write across brokers.' },
      { section: 'Replication', content: 'Each partition has a leader and N-1 follower replicas. Producers write to the leader. Followers fetch and replicate. If leader fails, ZooKeeper/KRaft elects a new leader from in-sync replicas (ISR).' },
      { section: 'Producer', content: 'Producer hashes the message key to determine which partition to write to. Batches messages for throughput. acks=all waits for all ISR replicas to confirm before acknowledging the producer.' },
      { section: 'Consumer Groups', content: 'Each partition is consumed by exactly one consumer within a group. Multiple groups can read the same topic independently. Kafka tracks committed offsets per (group, topic, partition) in an internal topic (__consumer_offsets).' },
      { section: 'Log Compaction', content: 'Kafka can run log compaction on a topic: keep only the latest message per key (useful for CDC/change data capture). Combine with time-based retention for mixed workloads.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Prod1[Producer A]
        Prod2[Producer B]
        ConsA1[Consumer Group A Worker 1]
        ConsA2[Consumer Group A Worker 2]
        ConsB1[Consumer Group B Worker]
        StreamApp[Stream Processor Flink]
    end
    subgraph Gateway
        direction TB
        Bootstrap[Bootstrap Servers]
        SchemaReg[Schema Registry]
    end
    subgraph Services
        direction TB
        Broker1[Broker 1]
        Broker2[Broker 2]
        Broker3[Broker 3]
        Controller[Controller KRaft]
        GroupCoord[Group Coordinator]
        ISR[ISR Tracker]
    end
    subgraph Async
        direction TB
        P1Leader[Partition 1 Leader on B1]
        P1F1[Partition 1 Follower B2]
        P1F2[Partition 1 Follower B3]
        P2Leader[Partition 2 Leader on B2]
        Compaction[Log Compaction Job]
        Retention[Retention Cleaner]
        MirrorMaker[MirrorMaker Cross Cluster]
    end
    subgraph Storage
        direction TB
        Segments1[(Topic Segments Disk B1)]
        Segments2[(Topic Segments Disk B2)]
        Segments3[(Topic Segments Disk B3)]
        OffsetsTopic[(__consumer_offsets)]
        MetaLog[(KRaft Metadata Log)]
    end
    subgraph Analytics
        direction TB
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

    Prod1 ~~~ Bootstrap ~~~ Broker1 ~~~ P1Leader ~~~ Segments1 ~~~ ConnectSink

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class Segments1,Segments2,Segments3,OffsetsTopic,MetaLog storage
    class P1Leader,P1F1,P1F2,P2Leader,Compaction,Retention,MirrorMaker async
    class ConnectSink,Warehouse analytics`,
    tradeoffs: [
      { decision: 'acks=all vs acks=1', rationale: 'acks=all guarantees no data loss (waits for all ISR replicas). acks=1 is faster but risks data loss if leader fails before replication. Use acks=all for financial data.' },
    ],
    keyTakeaways: ['Partitioning enables horizontal throughput scaling; partition count determines max parallelism', 'ISR-based replication ensures no data loss without sacrificing too much latency', 'Consumer groups allow independent processing pipelines on the same event stream'],
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
      { section: 'Location Service', content: 'Drivers send GPS coordinates every 4s via WebSocket or HTTP. Location service writes to Redis GeoSet (GEOADD) keyed by city. Queries for "drivers within Xkm of point" use GEORADIUS in O(N+log(M)) time.' },
      { section: 'Matching Service', content: 'On ride request, query Location Service for drivers within 5km. Score candidates (distance, rating, car type). Offer the trip to the best driver. If declined within 5s, offer to next driver. Repeat until accepted or no drivers found.' },
      { section: 'Trip State Machine', content: 'Trip states: REQUESTED → ACCEPTED → DRIVER_ARRIVING → IN_PROGRESS → COMPLETED. State stored in a fast KV store (Redis) during the trip, then persisted to Cassandra on completion.' },
      { section: 'Surge Pricing', content: 'Aggregate supply (available drivers) and demand (open requests) per geo-cell (H3 hexagons) every 30s. Compute surge multiplier = demand/supply. Cap at 3×. Communicated to rider before confirmation.' },
      { section: 'Real-time Updates', content: 'Driver app and rider app maintain WebSocket connections to a gateway. During a trip, the gateway forwards driver location to the rider\'s socket. Gateway cluster uses Redis pub/sub to route messages across gateway nodes.' },
      { section: 'Observability', content: 'Key metrics: match latency P99 (alert if >3s), location update staleness (alert if >10s gap for active driver), active WebSocket connections per gateway node, Redis GeoSet operation latency. Business metrics: match rate, cancel rate, surge multiplier per city. Dashboards split by city/region since demand is geographically localized.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        DriverApp[Driver App]
        RiderApp[Rider App]
    end
    subgraph Edge [Realtime Edge]
        direction TB
        WSGW[WebSocket Gateway]
        APIGW[API Gateway]
        PubSub[Redis Pub Sub]
    end
    subgraph Services
        direction TB
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
        direction TB
        EventBus[Kafka Trip Events]
        SurgeJob[Surge Aggregator H3 Hex]
        PayBatch[Payment Settlement]
        MLTrain[ETA Model Trainer]
    end
    subgraph Storage
        direction TB
        GeoRedis[(Redis GeoSet)]
        TripRedis[(Active Trip Cache)]
        TripDB[(Completed Trips Cassandra)]
        PayDB[(Payments DB)]
        UserDB[(User DB)]
        RatingDB[(Ratings DB)]
        SurgeStore[(Surge Multiplier Cache)]
    end
    subgraph Analytics
        direction TB
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

    DriverApp ~~~ WSGW ~~~ LocSvc ~~~ EventBus ~~~ GeoRedis ~~~ Lake

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class GeoRedis,TripRedis,TripDB,PayDB,UserDB,RatingDB,SurgeStore storage
    class EventBus,SurgeJob,PayBatch,MLTrain async
    class WSGW,APIGW,PubSub edge
    class Lake,Feature analytics`,
    tradeoffs: [
      { decision: 'Redis GEORADIUS vs PostGIS', rationale: 'Redis is in-memory with sub-millisecond geospatial queries. PostGIS has richer query capabilities but is slower for high-frequency location updates. Redis wins for real-time matching.' },
    ],
    keyTakeaways: ['Redis GeoSets provide sub-millisecond proximity queries for driver matching', 'H3 hexagonal grids enable efficient surge pricing per geographic area', 'WebSocket gateways with Redis pub/sub scale real-time location fanout across server instances'],
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
      { section: 'Connection Management', content: 'Each client maintains a persistent WebSocket connection to a Chat Server. A connection registry (stored in Redis/ZooKeeper) maps user_id to chat_server_id so messages can be routed to the correct server.' },
      { section: 'Message Flow', content: 'Sender → Chat Server A. Chat Server A looks up recipient\'s server (Registry). Forwards message to Chat Server B. Chat Server B pushes to recipient\'s WebSocket. Both servers ACK back to sender for delivery status.' },
      { section: 'Offline Message Queue', content: 'If recipient is offline, message stored in an offline queue (Cassandra partitioned by recipient_id). On reconnect, client polls for queued messages, then switches to WebSocket for real-time delivery.' },
      { section: 'Group Messaging', content: 'Fan-out service expands a group message to individual messages for each member. For large groups, this fan-out is async via a queue. Each member\'s Chat Server gets the message for their connected members.' },
      { section: 'End-to-End Encryption', content: 'Signal Protocol: each user has a public/private key pair. Messages encrypted with recipient\'s public key on sender\'s device. Server stores and routes only ciphertext — cannot read messages.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        UserA[User A Device]
        UserB[User B Device]
        GroupMember[Group Member Device]
        WebSession[Web Companion]
    end
    subgraph Edge
        direction TB
        GeoDNS[Geo-DNS]
        WSLB[WebSocket Load Balancer]
        CDN[Media CDN]
    end
    subgraph Gateway
        direction TB
        APIGW[REST API Gateway]
        Auth[Auth and Device Pairing]
    end
    subgraph Services
        direction TB
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
        direction TB
        FanoutQ[Group Fan-out Queue]
        MediaProc[Media Transcoder]
        OfflineDeliver[Offline Delivery Job]
        TombstoneGC[Delivered Message GC]
    end
    subgraph Storage
        direction TB
        Registry[(Connection Registry Redis)]
        OfflineQ[(Offline Queue Cassandra)]
        UserDB[(User and Contacts DB)]
        GroupDB[(Group Membership DB)]
        KeyStore[(Public Key Store)]
        MediaBlob[(Media Blob S3)]
        ReceiptDB[(Read Receipts)]
    end
    subgraph Analytics
        direction TB
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

    UserA ~~~ GeoDNS ~~~ APIGW ~~~ ChatA ~~~ FanoutQ ~~~ Registry ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class Registry,OfflineQ,UserDB,GroupDB,KeyStore,MediaBlob,ReceiptDB storage
    class FanoutQ,MediaProc,OfflineDeliver,TombstoneGC async
    class GeoDNS,WSLB,CDN edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Store messages on server vs client-only', rationale: 'Server-side storage enables multi-device sync and message history. Client-only (like Signal) maximizes privacy. WhatsApp stores messages temporarily on server until delivered, then deletes.' },
    ],
    keyTakeaways: ['Connection registry enables message routing across a stateful WebSocket server fleet', 'Cassandra is ideal for the offline queue due to high write throughput and TTL support', 'Signal Protocol enables end-to-end encryption without the server being able to read messages'],
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
      { section: 'Stream Ingest', content: 'Streamers use OBS/streaming software to push RTMP to the nearest ingest edge server. RTMP is low-latency for upload. Ingest edge converts RTMP to HLS segments (2-second chunks) and pushes to origin.' },
      { section: 'Transcoding', content: 'Ingest edge triggers a transcoding job per stream. Transcoder workers produce 4 quality variants (160p, 360p, 720p, 1080p) simultaneously. Segments pushed to CDN origin storage immediately.' },
      { section: 'Delivery via CDN', content: 'HLS manifest (.m3u8) and segments served from CDN. First viewer in a region fetches from origin (CDN miss); subsequent viewers hit the CDN edge. Target CDN cache hit ratio >95% for popular streams.' },
      { section: 'Latency Reduction', content: 'Standard HLS has ~20–30s glass-to-glass latency because the player buffers 3 segments (each typically 6–10s) before playback begins. Low-Latency HLS (LL-HLS) uses 200ms partial segments pushed to CDN, reducing latency to ~2–3s. WebRTC can achieve <1s latency but does not scale to millions of viewers via CDN.' },
      { section: 'Live Chat', content: 'Chat messages go through a separate WebSocket-based chat service. Messages stored in Redis pub/sub and fanout to all connected viewers for that stream. Moderation bots scan messages asynchronously.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Streamer[Streamer OBS]
        Viewer[Viewer Web]
        ViewerMobile[Viewer Mobile]
        ChatUser[Chat Viewer]
    end
    subgraph Edge
        direction TB
        IngestEdge[RTMP Ingest Edge]
        CDNEdge[CDN Edge LL-HLS]
        WSGateway[Chat WebSocket Gateway]
    end
    subgraph Gateway
        direction TB
        APIGW[API Gateway]
        Auth[Auth and Streamer Keys]
    end
    subgraph Services
        direction TB
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
        direction TB
        TranscoderFarm[Transcoder Workers 160 to 1080p]
        ManifestUpd[Manifest Updater]
        ChatPubSub[Chat Redis Pub Sub]
        ModBot[Async Moderation Bot]
        ThumbGen[Thumbnail Generator]
    end
    subgraph Storage
        direction TB
        CDNOrigin[(CDN Origin Segments)]
        VODBlob[(VOD Archive S3)]
        StreamMeta[(Stream Metadata DB)]
        ChatHistory[(Chat History Cassandra)]
        UserDB[(User DB)]
        DRMTokens[(DRM Token Store)]
    end
    subgraph Analytics
        direction TB
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

    Streamer ~~~ IngestEdge ~~~ APIGW ~~~ StreamMgr ~~~ TranscoderFarm ~~~ CDNOrigin ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class CDNOrigin,VODBlob,StreamMeta,ChatHistory,UserDB,DRMTokens storage
    class TranscoderFarm,ManifestUpd,ChatPubSub,ModBot,ThumbGen async
    class IngestEdge,CDNEdge,WSGateway edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'HLS vs WebRTC for delivery', rationale: 'HLS scales to millions of viewers via CDN. WebRTC achieves sub-second latency but requires peer-to-peer or SFU infrastructure that does not scale beyond ~100K viewers per stream efficiently.' },
    ],
    keyTakeaways: ['RTMP ingest + HLS delivery is the proven architecture for massive-scale live streaming', 'LL-HLS reduces standard HLS 30s latency to ~3s without sacrificing CDN compatibility', 'Separate chat infrastructure decouples chat scaling from video delivery'],
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
      { section: 'URL Frontier', content: 'A priority queue of URLs to crawl, partitioned by domain. Priority based on PageRank estimate and freshness. Implemented as a distributed queue (Kafka or Redis) with per-domain politeness delay enforcement (1 req/sec per domain).' },
      { section: 'URL Deduplication', content: 'Before adding a URL to the frontier, check a Bloom filter (fast, memory-efficient, may have false positives) and a persistent seen-URLs set (Cassandra). Bloom filter eliminates ~99% of duplicate checks without hitting the DB.' },
      { section: 'Distributed Crawl Workers', content: 'Worker pool fetches URLs from the frontier, downloads pages, parses HTML (via JSoup or similar), extracts links. Workers partitioned by URL hash so each domain is handled by the same worker pool (preserving politeness state).' },
      { section: 'Politeness & robots.txt', content: 'Fetch and cache robots.txt per domain (TTL 24h). Enforce crawl-delay from robots.txt or default to 1 req/sec. Use a token bucket per domain. Respect Disallow directives before fetching any page.' },
      { section: 'Content Storage', content: 'Raw HTML stored in S3. A fingerprint (SimHash) of the content stored in a DB to detect near-duplicate pages. Parsed content passed to an indexing pipeline via Kafka.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Seeds[Seed URL List]
        Sitemap[Sitemap Submitter]
        Web[Public Web]
    end
    subgraph Edge
        direction TB
        DNSCache[DNS Resolver Cache]
        FetcherEgress[Egress Pool Many IPs]
    end
    subgraph Gateway
        direction TB
        SchedAPI[Crawl Control API]
    end
    subgraph Services
        direction TB
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
        direction TB
        FrontierQ[URL Frontier Kafka]
        DomainQ[Per Domain Queue Redis]
        ContentQ[Parsed Content Topic]
        RecrawlSched[Recrawl Scheduler]
    end
    subgraph Storage
        direction TB
        BloomStore[(Bloom Filter)]
        SeenSet[(Seen URLs Cassandra)]
        RobotsCache[(Robots Cache Redis)]
        RawHTML[(Raw HTML S3)]
        FingerprintDB[(SimHash DB)]
        DomainPRank[(Domain PageRank Store)]
    end
    subgraph Analytics
        direction TB
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

    Seeds ~~~ DNSCache ~~~ SchedAPI ~~~ FrontierMgr ~~~ FrontierQ ~~~ BloomStore ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class BloomStore,SeenSet,RobotsCache,RawHTML,FingerprintDB,DomainPRank storage
    class FrontierQ,DomainQ,ContentQ,RecrawlSched async
    class DNSCache,FetcherEgress edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'BFS vs priority crawl', rationale: 'BFS treats all URLs equally. Priority crawl (Mercator-style) prioritizes high-PageRank or frequently updated pages. Priority crawl produces a better index with the same compute budget.' },
    ],
    keyTakeaways: ['Bloom filters provide O(1) deduplication at the cost of a small false-positive rate', 'Partitioning workers by domain is essential for politeness enforcement', 'SimHash detects near-duplicate pages to avoid storing redundant content'],
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
      { section: 'Snowflake Structure', content: '64-bit ID layout: [1 bit sign] [41 bits timestamp ms since epoch] [10 bits machine ID] [12 bits sequence number]. Timestamp gives ~69 years of IDs. Machine ID: 5 bits datacenter + 5 bits worker. Sequence rolls over every millisecond.' },
      { section: 'Timestamp', content: '41 bits of milliseconds since a custom epoch (e.g., 2020-01-01). Gives 2^41 ms = 69 years. The timestamp component makes IDs roughly sortable by creation time.' },
      { section: 'Machine ID Assignment', content: 'Each worker node gets a unique 10-bit machine ID at startup from a coordination service (ZooKeeper). Machine ID is cached locally — no per-ID coordination needed.' },
      { section: 'Sequence Number', content: '12-bit counter incremented per ID within the same millisecond. Resets to 0 on the next millisecond. If the sequence overflows (>4,095 IDs in one ms), the generator waits for the next millisecond.' },
      { section: 'Clock Skew Handling', content: 'If system clock goes backwards (NTP adjustment), IDs could duplicate. Mitigation: detect clock going backwards and wait for time to catch up. Log and alert on clock skew > 10ms.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        TweetSvc[Tweet Service]
        OrderSvc[Order Service]
        PaymentSvc[Payment Service]
        BatchJob[Batch Job]
    end
    subgraph Gateway
        direction TB
        SDK[ID Generator SDK]
        LB[Load Balancer]
    end
    subgraph Services
        direction TB
        IDGen1[ID Generator Node 1]
        IDGen2[ID Generator Node 2]
        IDGen3[ID Generator Node N]
        Composer[Bit Composer 41 ts 10 machine 12 seq]
        ClockGuard[Clock Skew Detector]
        SeqCounter[Per ms Sequence Counter]
        BootstrapSvc[Machine ID Bootstrap]
    end
    subgraph Async
        direction TB
        AlertJob[Clock Skew Alert]
        NTPSync[NTP Sync Daemon]
        MetricsAgg[Throughput Metrics]
    end
    subgraph Storage
        direction TB
        ZK[(ZooKeeper Machine ID Registry)]
        EpochCfg[(Custom Epoch Config)]
        SkewLog[(Skew Event Log)]
    end
    subgraph Analytics
        direction TB
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

    TweetSvc ~~~ SDK ~~~ IDGen1 ~~~ AlertJob ~~~ ZK ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class ZK,EpochCfg,SkewLog storage
    class AlertJob,NTPSync,MetricsAgg async
    class LB edge
    class EventBus,Dash analytics`,
    tradeoffs: [
      { decision: 'Snowflake vs UUID v4', rationale: 'Snowflake IDs are time-sortable (better for B-tree DB indexes), shorter (64 vs 128 bits), and human-debuggable (timestamp is extractable). UUID v4 needs no coordination service at all but is not sortable.' },
    ],
    keyTakeaways: ['Snowflake IDs are time-sortable, compact, and require no per-ID network calls', '41 bits of milliseconds provide ~69 years of unique IDs per worker', 'Clock-skew detection is essential — backwards timestamps break uniqueness guarantees'],
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
      { section: 'Hash Ring', content: 'Map the hash space [0, 2^32) onto a ring. Hash each node to a position on the ring using a hash function (e.g., MD5, MurmurHash3). A key is assigned to the first node clockwise from the key\'s hash position.' },
      { section: 'Virtual Nodes (Vnodes)', content: 'A single physical node is represented by 150 virtual nodes at different ring positions (using node_id + index as hash input). This balances load even when nodes have different capacities and prevents hotspots from single-node assignment.' },
      { section: 'Node Addition', content: 'New node hashes to K positions on the ring. For each of those K positions, the new node takes ownership of keys between the previous node and itself. Only ~1/N total keys are remapped. These keys are migrated from their previous owner.' },
      { section: 'Node Removal', content: 'Reverse of addition. The removed node\'s key ranges are transferred to the next clockwise nodes. Again, only ~1/N keys are affected. Ring position table is updated in the cluster\'s metadata store.' },
      { section: 'Implementation', content: 'Store ring as a sorted array of (hash_value, node_id) pairs. Lookup = binary search for first position >= key_hash. O(log N) time. Additions/removals update the sorted array and trigger key migration for affected ranges.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        AppClient[Application Client]
        SDK[Smart Client SDK]
    end
    subgraph Gateway
        direction TB
        Hasher[Hash Function MurmurHash3]
        Lookup[Ring Lookup Binary Search]
    end
    subgraph Services
        direction TB
        Ring[Hash Ring 0 to 2 to the 32]
        NodeA[Node A vnodes 150]
        NodeB[Node B vnodes 150]
        NodeC[Node C vnodes 150]
        NodeD[Node D newly added]
        Membership[Membership and Gossip]
        Rebalancer[Range Rebalancer]
    end
    subgraph Async
        direction TB
        Migrate[Key Migration Stream]
        HintedHandoff[Hinted Handoff Queue]
        VnodeBalancer[Vnode Load Balancer]
    end
    subgraph Storage
        direction TB
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

    AppClient ~~~ Hasher ~~~ Ring ~~~ Migrate ~~~ RingTable

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    class RingTable,ClusterMeta,KeyShardA,KeyShardB,KeyShardC storage
    class Migrate,HintedHandoff,VnodeBalancer async`,
    tradeoffs: [
      { decision: '150 vnodes vs fewer', rationale: 'More vnodes means better load balance and smaller key migration on node changes, but higher memory overhead in the ring table and more complex migration coordination.' },
    ],
    keyTakeaways: ['Consistent hashing limits key remapping to ~1/N on node changes, vs 100% with modular hashing', 'Virtual nodes achieve statistical load balance without manual range assignment', 'The ring is stored as a sorted array; lookups are O(log N) binary search'],
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
      { section: 'Raft-Based Implementation', content: 'Use a strongly consistent Raft cluster (3 or 5 nodes). Lock state stored as key-value entries in the replicated log. A lock acquisition requires a majority quorum write. Guarantees at most one lock holder even under network partition.' },
      { section: 'Lock TTL and Lease', content: 'Each lock has a TTL (e.g., 30s). Holder must renew the lease before it expires. If the holder crashes, the lock expires automatically and becomes available. TTL prevents permanent lock hold on holder failure.' },
      { section: 'Fencing Tokens', content: 'When a lock is acquired, the service returns a monotonically increasing token (fencing token). The protected resource must reject requests with a token lower than the highest seen. Prevents stale lock holders from corrupting state after lease expiry.' },
      { section: 'Sequencer Nodes (ZooKeeper Pattern)', content: 'ZooKeeper-style: clients create ephemeral sequential nodes under a lock path. The node with the lowest sequence number holds the lock. Others watch the node immediately before them. On deletion, the next node gets notified — no thundering herd.' },
      { section: 'RedLock (Redis)', content: 'Redis-based: acquire lock on majority (N/2+1) of N independent Redis nodes using SET NX PX. Considered safe if clock drift < TTL/3. Controversial — Martin Kleppmann argues it is not safe under GC pauses. Use Raft-based locks for correctness-critical scenarios.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        ClientA[Worker A]
        ClientB[Worker B]
        ClientC[Worker C]
    end
    subgraph Gateway
        direction TB
        LockSDK[Lock SDK]
        LB[Load Balancer]
    end
    subgraph Services
        direction TB
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
        direction TB
        LeaseExpiry[Lease Expiry Sweeper]
        ElectionJob[Leader Election]
        SnapshotJob[Raft Snapshot]
    end
    subgraph Storage
        direction TB
        RaftLog[(Replicated Raft Log)]
        LockState[(Lock State KV)]
        TokenCounter[(Monotonic Fencing Counter)]
        Snapshot[(Snapshot Store)]
    end
    subgraph Services2 [Protected Resource]
        direction TB
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

    ClientA ~~~ LockSDK ~~~ LockSvc ~~~ LeaseExpiry ~~~ RaftLog

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    class RaftLog,LockState,TokenCounter,Snapshot storage
    class LeaseExpiry,ElectionJob,SnapshotJob async
    class LB edge`,
    tradeoffs: [
      { decision: 'Raft-based vs Redis RedLock', rationale: 'Raft guarantees correctness under all failure modes including GC pauses and clock drift. RedLock is simpler to deploy but has documented safety gaps. Use Raft for financial/inventory systems.' },
    ],
    keyTakeaways: ['Fencing tokens are essential — TTL expiry alone cannot prevent two holders from operating simultaneously', 'ZooKeeper ephemeral sequential nodes avoid thundering herd on lock release', 'Raft consensus is the only approach proven safe under arbitrary process pauses'],
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
      { section: 'Crawling', content: 'Distributed crawler (see Web Crawler design) continuously fetches and re-fetches pages. Prioritizes high-PageRank and frequently changing pages. Raw HTML stored in blob storage.' },
      { section: 'Inverted Index', content: 'For each word, store a posting list: list of (document_id, TF score, positions) tuples sorted by relevance score. Index sharded across thousands of servers by term hash. MapReduce jobs build the index from crawled HTML.' },
      { section: 'Query Processing', content: 'Query parsed into tokens. For each token, fetch the posting list from the index shard. Intersect posting lists (AND query) or merge (OR query). Apply BM25 scoring. Top 10 results returned.' },
      { section: 'Ranking (PageRank + ML)', content: 'Base relevance: BM25 TF-IDF. PageRank computed offline via iterative graph algorithm (each page\'s rank flows to outbound links). ML ranking model (BERT-based, trained on click data) reranks the top-K candidates at query time.' },
      { section: 'Serving Tier', content: 'Query hits a root server, which fans out to hundreds of leaf index servers in parallel. Each leaf returns its local top-K. Root merges all results, applies global ranking, fetches document snippets, returns top 10.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Browser[Browser]
        MobileApp[Mobile App]
        VoiceSearch[Voice Search]
    end
    subgraph Edge
        direction TB
        CDN[Global Edge Cache]
        GeoDNS[Geo-DNS]
    end
    subgraph Gateway
        direction TB
        APIGW[Search Frontend]
        AntiSpam[Spam and Bot Filter]
    end
    subgraph Services
        direction TB
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
        direction TB
        Crawler[Distributed Crawler]
        Indexer[Index Builder MapReduce]
        PageRankJob[PageRank Iterative]
        Incremental[Incremental Indexer]
        ClickLog[Click Log Pipeline]
    end
    subgraph Storage
        direction TB
        BlobStore[(Crawled HTML S3)]
        InvIdx1[(Inverted Index Shard 1)]
        InvIdx2[(Inverted Index Shard 2)]
        InvIdxN[(Inverted Index Shard N)]
        DocStore[(Doc and Snippet Store)]
        PRStore[(PageRank Scores)]
        QueryCache[(Hot Query Cache)]
    end
    subgraph Analytics
        direction TB
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

    Browser ~~~ CDN ~~~ APIGW ~~~ QueryParser ~~~ Crawler ~~~ BlobStore ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class BlobStore,InvIdx1,InvIdx2,InvIdxN,DocStore,PRStore,QueryCache storage
    class Crawler,Indexer,PageRankJob,Incremental,ClickLog async
    class CDN,GeoDNS edge
    class EventBus,Lake,ModelStore analytics`,
    tradeoffs: [
      { decision: 'Batch index rebuild vs incremental indexing', rationale: 'Batch rebuild (MapReduce) is simpler but slow to reflect new content. Incremental indexing (streaming) keeps the index fresh but is harder to implement correctly. Modern search engines use a hybrid.' },
    ],
    keyTakeaways: ['The inverted index is the core data structure — maps terms to document lists for fast lookup', 'Fan-out to hundreds of index shards in parallel enables sub-200ms query latency', 'PageRank is computed offline as a link-graph algorithm; ML reranking runs online on the top-K candidates'],
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
      { section: 'Trie Data Structure', content: 'Store all valid search prefixes in a trie. Each node stores the top-5 completions for that prefix (by frequency score). Look up is O(prefix_length) — traverse trie path, return stored top-5.' },
      { section: 'Frequency Scoring', content: 'Search logs aggregated via MapReduce (or Apache Spark) daily. Each query gets a frequency score. Trie nodes store top-5 completions by score. Score formula can incorporate recency (decay older searches).' },
      { section: 'Trie Storage', content: 'Trie stored in-process on suggestion servers (sharded by first character prefix). Total trie size ~1GB per server. Servers load the trie from a pre-built snapshot (rebuilt nightly) stored in S3.' },
      { section: 'Caching Layer', content: 'In-memory cache (Redis) for the most popular prefixes (top 10K). Cache hit rate >90%. Cache updated asynchronously when scores change. Cache first, trie fallback for cache misses.' },
      { section: 'Real-time Trending', content: 'Stream search logs through Kafka. A streaming job (Flink) aggregates counts over a 1-hour sliding window. Top trending queries injected into the suggestion layer with a boost factor.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Browser[Browser Search Box]
        Mobile[Mobile App]
        Voice[Voice Assistant]
    end
    subgraph Edge
        direction TB
        CDN[CDN Edge]
        LB[Load Balancer]
    end
    subgraph Gateway
        direction TB
        APIGW[Suggestion API]
        RL[Rate Limiter]
    end
    subgraph Services
        direction TB
        Router[Prefix Shard Router]
        TrieShardA[Trie Server Shard A]
        TrieShardB[Trie Server Shard B]
        TrieShardC[Trie Server Shard C]
        Personalizer[Personalization Layer]
        LangSvc[Language Router]
        TrendBoost[Trending Booster]
    end
    subgraph Async
        direction TB
        Kafka[Search Log Stream]
        SparkBatch[Spark Batch Scoring]
        FlinkStream[Flink Sliding Window]
        TrieBuilder[Trie Snapshot Builder]
        CacheWarmer[Hot Prefix Cache Warmer]
    end
    subgraph Storage
        direction TB
        HotCache[(Redis Top 10K Prefixes)]
        TrieSnapshot[(Trie Snapshot S3)]
        FreqDB[(Frequency Score DB)]
        TrendStore[(Trending Counts Redis)]
        UserProfile[(User History Store)]
    end
    subgraph Analytics
        direction TB
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

    Browser ~~~ CDN ~~~ APIGW ~~~ Router ~~~ Kafka ~~~ HotCache ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class HotCache,TrieSnapshot,FreqDB,TrendStore,UserProfile storage
    class Kafka,SparkBatch,FlinkStream,TrieBuilder,CacheWarmer async
    class CDN,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Trie vs inverted index for autocomplete', rationale: 'Trie lookup by prefix is O(prefix_length) — extremely fast. Inverted index is better for mid-string search. For prefix autocomplete, trie wins; for fuzzy/substring, use Elasticsearch.' },
    ],
    keyTakeaways: ['Pre-storing top-5 completions at each trie node makes lookups O(prefix_length) with no aggregation at query time', 'Caching the most frequent 10K prefixes covers >90% of traffic at negligible memory cost', 'Sliding window aggregation via Flink enables near-real-time trending without full trie rebuilds'],
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
      { section: 'Indexing with Elasticsearch', content: 'Each product is a document in Elasticsearch with fields: title (analyzed, boosted 3×), description (analyzed), category, brand (keyword), price (numeric), rating (float), reviews_count, created_at. Full-text fields use BM25 scoring.' },
      { section: 'Query Structure', content: 'Search request translates to a bool query: must (keyword match), filter (category, price range, brand — cached in filter cache), should (boosting fields). Filters run first (they\'re cached), dramatically reducing the candidate set.' },
      { section: 'Faceted Navigation', content: 'Aggregations on filtered result set: category counts, price histogram, brand counts, avg rating. Run in parallel with the main query. Results power the filter sidebar on the search results page.' },
      { section: 'Personalized Ranking', content: 'Base ranking: BM25 + business rules (promoted products, in-stock penalty). Personalization layer: re-rank top-200 results using a learned ranking model (LambdaMART or two-tower neural model) trained on click/purchase data. Applied per user in < 50ms.' },
      { section: 'Index Updates', content: 'Product catalog changes flow through Kafka. An indexing consumer reads events and calls Elasticsearch bulk API. Price/inventory changes indexed within 5 minutes. New product launches indexed immediately.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Shopper[Web Shopper]
        MobileApp[Mobile App]
        VoiceAssist[Voice Search]
    end
    subgraph Edge
        direction TB
        CDN[CDN Static Assets]
        LB[Load Balancer]
    end
    subgraph Gateway
        direction TB
        APIGW[Search API]
        Auth[Auth Service]
    end
    subgraph Services
        direction TB
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
        direction TB
        Kafka[Catalog Change Events]
        BulkIndexer[Bulk Index Consumer]
        ClickStream[Click and Purchase Stream]
        ModelTrainer[Ranking Model Trainer]
        PriceUpdate[Price Inventory Updater]
    end
    subgraph Storage
        direction TB
        ESIndex[(Elasticsearch Index 20 shards)]
        Catalog[(Product Catalog DB)]
        UserProfile[(User Click History)]
        FilterCache[(Filter Bitset Cache)]
        ModelStore[(Ranking Model Store)]
        InventoryDB[(Inventory DB)]
    end
    subgraph Analytics
        direction TB
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

    Shopper ~~~ CDN ~~~ APIGW ~~~ QueryParser ~~~ Kafka ~~~ ESIndex ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class ESIndex,Catalog,UserProfile,FilterCache,ModelStore,InventoryDB storage
    class Kafka,BulkIndexer,ClickStream,ModelTrainer,PriceUpdate async
    class CDN,LB edge
    class EventBus,Lake,FeatureStore analytics`,
    tradeoffs: [
      { decision: 'Elasticsearch vs custom inverted index', rationale: 'Elasticsearch provides out-of-the-box faceting, fuzzy matching, aggregations, and horizontal scaling. A custom index can be faster for specific queries but requires years of engineering. Use Elasticsearch unless you outgrow it.' },
    ],
    keyTakeaways: ['Elasticsearch filter cache makes faceted navigation fast — filters reuse cached bitsets', 'Separate base ranking (BM25) from personalization (ML reranking) keeps the system modular', 'Kafka-driven indexing decouples catalog updates from the search index'],
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
    capacityEstimates: `1M transactions/day ≈ 12 txns/sec average\nPeak: 10× ≈ 120 txns/sec\nStorage: 1M txns × 1KB = 1GB/day (small, but append forever)`,
    solutionBreakdown: [
      { section: 'Idempotency Keys', content: 'Every payment API call includes a client-generated idempotency_key. Server stores (idempotency_key → result) in a DB table before processing. On retry, return the cached result instead of processing again. Prevents double-charges on network retries.' },
      { section: 'Double-Entry Bookkeeping', content: 'Every payment creates two ledger entries: debit from source account, credit to destination account. Ledger table is append-only (never update rows). Balance = sum of all entries for an account. Audit-proof and tamper-evident.' },
      { section: 'Payment State Machine', content: 'States: PENDING → PROCESSING → SUCCEEDED / FAILED / REFUNDED. State transitions stored as events. Only forward transitions allowed. Disputed payments enter DISPUTED state pending chargeback resolution.' },
      { section: 'PSP Integration', content: 'Actual card processing delegated to a Payment Service Provider (Stripe, Adyen). System stores a PSP-provided token, not raw card numbers (PCI compliance). PSP webhooks update local payment status.' },
      { section: 'Reconciliation', content: 'Nightly reconciliation job compares internal ledger with PSP settlement files. Any discrepancy triggers an alert. Separate settlement service handles payouts to merchants with configurable delay (e.g., T+2).' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Merchant[Merchant API]
        Checkout[Checkout Page]
        MobileSDK[Mobile SDK]
    end
    subgraph Edge
        direction TB
        WAF[WAF and DDoS Shield]
        LB[Load Balancer]
    end
    subgraph Gateway
        direction TB
        APIGW[Payment API]
        Auth[Auth and API Keys]
        IdempCheck[Idempotency Middleware]
    end
    subgraph Services
        direction TB
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
        direction TB
        Recon[Nightly Reconciliation Job]
        RetryQ[Failed Webhook Retry]
        FraudTrainer[Fraud Model Trainer]
        PayoutBatch[T+2 Payout Batcher]
        DLQ[Dead Letter Queue]
    end
    subgraph Services2 [PSPs]
        direction TB
        Stripe[PSP Stripe]
        Adyen[PSP Adyen]
        BankRail[ACH and Wire Rails]
    end
    subgraph Storage
        direction TB
        IdempDB[(Idempotency Key Store)]
        Ledger[(Double Entry Ledger Append Only)]
        TxnDB[(Transaction State DB)]
        FraudFeatures[(Fraud Feature Store)]
        VaultPCI[(Tokenized Card Vault PCI)]
        MerchantDB[(Merchant Accounts)]
        AuditLog[(Audit Trail)]
    end
    subgraph Analytics
        direction TB
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

    Merchant ~~~ WAF ~~~ APIGW ~~~ Authorize ~~~ Recon ~~~ IdempDB ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class IdempDB,Ledger,TxnDB,FraudFeatures,VaultPCI,MerchantDB,AuditLog storage
    class Recon,RetryQ,FraudTrainer,PayoutBatch,DLQ async
    class WAF,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Synchronous PSP call vs async queue', rationale: 'Synchronous call gives the user an immediate result but ties up a thread per payment. Async queue decouples throughput but requires status polling or webhooks. Most payment UIs prefer synchronous for UX.' },
    ],
    keyTakeaways: ['Idempotency keys are the critical mechanism to prevent double-charges on retries', 'Double-entry bookkeeping makes the ledger append-only and audit-proof', 'Never store raw card numbers — use PSP tokenization for PCI compliance'],
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
      { section: 'Inventory Model', content: 'room_inventory(hotel_id, room_type, date, total_count, reserved_count). A reservation succeeds only if reserved_count < total_count. Atomic update: UPDATE SET reserved_count = reserved_count + 1 WHERE reserved_count < total_count.' },
      { section: 'Reservation Flow (Optimistic Locking)', content: 'Read current inventory (with version). Attempt to place reservation. DB update checks version hasn\'t changed (optimistic lock). If version mismatch, retry. This avoids lock contention for the common case (non-competing reservations).' },
      { section: 'Pessimistic Locking for High Demand', content: 'For flash sales where many users compete for the same room: use SELECT FOR UPDATE to lock the inventory row. Queue competing transactions. Fair but slower — only use for known high-contention inventory.' },
      { section: 'Two-Phase Reservation', content: 'HOLD: reserve room with 10-minute TTL (user must complete payment). CONFIRM: on successful payment, confirm reservation and remove TTL. RELEASE: if payment not received within TTL, release the hold. Prevents rooms being blocked indefinitely.' },
      { section: 'Search Service', content: 'Separate read-optimized search index (Elasticsearch). Hotel inventory replicated to ES via change data capture (Debezium). Search results may be slightly stale (acceptable). Actual availability check done against the source DB at booking time.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Traveler[Traveler Web]
        Mobile[Mobile App]
        HotelMgr[Hotel Manager Console]
    end
    subgraph Edge
        direction TB
        CDN[CDN Static Assets]
        LB[Load Balancer]
    end
    subgraph Gateway
        direction TB
        APIGW[API Gateway]
        Auth[Auth Service]
        RL[Rate Limiter]
    end
    subgraph Services
        direction TB
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
        direction TB
        CDCStream[Inventory CDC Debezium]
        HoldExpiry[Hold TTL Sweeper]
        Indexer[Search Indexer]
        PriceJob[Dynamic Price Updater]
        EmailQ[Confirmation Email Queue]
    end
    subgraph Storage
        direction TB
        InventoryDB[(Inventory DB PostgreSQL)]
        BookingDB[(Bookings DB)]
        ES[(Elasticsearch Hotel Index)]
        HoldsRedis[(Active Holds Redis TTL)]
        HotelDB[(Hotel Catalog)]
        ReviewDB[(Reviews DB)]
        PriceDB[(Rate and Price History)]
    end
    subgraph Analytics
        direction TB
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

    Traveler ~~~ CDN ~~~ APIGW ~~~ SearchSvc ~~~ CDCStream ~~~ InventoryDB ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class InventoryDB,BookingDB,ES,HoldsRedis,HotelDB,ReviewDB,PriceDB storage
    class CDCStream,HoldExpiry,Indexer,PriceJob,EmailQ async
    class CDN,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Optimistic vs pessimistic locking for reservations', rationale: 'Optimistic locking is faster under low contention (most cases). Pessimistic locking is fairer and avoids starvation under high contention (flash sales). Use optimistic by default, pessimistic for flash sales.' },
    ],
    keyTakeaways: ['Two-phase hold-then-confirm prevents rooms from being blocked by abandoned checkouts', 'Separate search (ES) from booking (relational DB) — search can be stale, booking must be consistent', 'Optimistic locking scales better than pessimistic for typical hotel booking concurrency'],
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
      { section: 'Flight Search', content: 'Aggregator queries Global Distribution System (GDS) APIs (Amadeus, Sabre) or airline NDC APIs. Results cached aggressively (fare quotes valid for 5 minutes). Elasticsearch for fast multi-city itinerary search.' },
      { section: 'Seat Inventory', content: 'Airlines maintain seat inventory in their own Passenger Service Systems (PSS). The booking platform queries PSS via API or GDS. Seat availability is never fully in our control — always validate with airline before confirming.' },
      { section: 'PNR & Seat Hold', content: 'On user selection, create a Passenger Name Record (PNR) with the airline. PNR holds the seat for 10–15 minutes (airline-enforced). During hold, user completes payment. After hold expiry, seat released.' },
      { section: 'Dynamic Pricing', content: 'Fares are rule-based (fare class, advance purchase, day-of-week, seat class). Pricing engine evaluates fare rules at query time. Machine learning models predict demand and adjust base fares (yield management). Prices change every few minutes.' },
      { section: 'Ticketing', content: 'On successful payment, send ticketing request to airline (via GDS or NDC). Airline generates e-ticket (confirmed PNR). Send itinerary to user via email. Store booking details in our DB with airline PNR reference.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Web[Traveler Web]
        Mobile[Mobile App]
        Agent[Travel Agent Tool]
    end
    subgraph Edge
        direction TB
        CDN[CDN]
        LB[Load Balancer]
    end
    subgraph Gateway
        direction TB
        APIGW[Booking API]
        Auth[Auth Service]
    end
    subgraph Services
        direction TB
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
        direction TB
        CacheRefresh[Fare Cache Refresher]
        HoldExpiry[PNR Hold Expiry Sweeper]
        PriceTrainer[Yield Model Trainer]
        EmailQ[Email Queue]
        FailRetry[Provider Retry Queue]
    end
    subgraph Services2 [External]
        direction TB
        GDSAmadeus[GDS Amadeus]
        GDSSabre[GDS Sabre]
        AirlineNDC[Airline NDC API]
        AirlinePSS[Airline PSS]
    end
    subgraph Storage
        direction TB
        FareCache[(Fare Cache Redis 5min TTL)]
        ItineraryDB[(Itinerary DB)]
        BookingDB[(Booking DB)]
        FareRulesDB[(Fare Rules DB)]
        FlightES[(Flight Search Index)]
        PriceHistory[(Pricing Model Store)]
    end
    subgraph Analytics
        direction TB
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

    Web ~~~ CDN ~~~ APIGW ~~~ SearchSvc ~~~ CacheRefresh ~~~ FareCache ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class FareCache,ItineraryDB,BookingDB,FareRulesDB,FlightES,PriceHistory storage
    class CacheRefresh,HoldExpiry,PriceTrainer,EmailQ,FailRetry async
    class CDN,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Cache fares vs real-time GDS query', rationale: 'Real-time GDS queries are expensive (latency + cost per call). Caching fares for 5 minutes dramatically reduces cost and improves search speed. Risk: user sees a cached price that has since changed; validate at booking time.' },
    ],
    keyTakeaways: ['GDS/NDC APIs are the integration layer — the airline always has the source of truth for seats', 'Fare caching for a short TTL balances search performance with price accuracy', 'PNR creation is a distributed operation across our system and the airline — design for partial failures'],
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
      { section: 'Order Matching Engine', content: 'Single-threaded matching engine per symbol (prevents race conditions with no locks). In-memory order book: two sorted data structures — buy side (max-heap by price), sell side (min-heap by price). Price-time priority: best price first, then earliest order. Written in C++/Java for microsecond latency.' },
      { section: 'Order Types', content: 'Market order: execute immediately at best available price. Limit order: add to order book if price not immediately satisfied, execute when matched. Stop order: becomes a market order when price reaches trigger. Fill-or-Kill: execute entirely or cancel immediately.' },
      { section: 'Market Data Feed', content: 'After each match, the engine publishes trade events and order book updates to a market data feed (Kafka). Subscribers (traders, trading algorithms, price displays) consume in near real-time. Feed partitioned by symbol.' },
      { section: 'Audit Trail', content: 'Every order event (submitted, modified, cancelled, filled) written to an immutable append-only ledger (Kafka + cold storage). Sequence numbers assigned by the matching engine. Used for regulatory reporting and post-trade analysis.' },
      { section: 'Risk Controls', content: 'Pre-trade risk checks before order reaches the matching engine: position limits, order size limits, price band checks (reject orders too far from market price). Prevents erroneous orders (fat-finger errors) that could crash the market.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        RetailTrader[Retail Trader]
        Algo[Algo Trader]
        FIXClient[FIX Institutional Client]
        Display[Price Display Subscriber]
    end
    subgraph Edge
        direction TB
        ColocGW[Colo Order Gateway FPGA]
        WSGW[WebSocket Market Data Gateway]
    end
    subgraph Gateway
        direction TB
        APIGW[Order API]
        Auth[Auth and Entitlements]
    end
    subgraph Services
        direction TB
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
        direction TB
        AuditStream[Audit Sequencer Kafka]
        MDStream[Market Data Feed Kafka]
        Reconcile[End of Day Reconcile]
        ColdArchive[Cold Storage Archiver]
        SurveillanceJob[Surveillance Replay]
    end
    subgraph Storage
        direction TB
        AuditLog[(Append Only Audit Log)]
        PortfolioDB[(Portfolio DB)]
        SettleDB[(Settlement DB)]
        RefData[(Symbol Reference Data)]
        UserDB[(User Accounts)]
        ColdS3[(Cold Archive S3)]
    end
    subgraph Analytics
        direction TB
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

    RetailTrader ~~~ ColocGW ~~~ APIGW ~~~ RiskEngine ~~~ AuditStream ~~~ AuditLog ~~~ TickStore

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class AuditLog,PortfolioDB,SettleDB,RefData,UserDB,ColdS3 storage
    class AuditStream,MDStream,Reconcile,ColdArchive,SurveillanceJob async
    class ColocGW,WSGW edge
    class TickStore,Dash analytics`,
    tradeoffs: [
      { decision: 'Single-threaded matching engine vs multi-threaded', rationale: 'Single-threaded eliminates lock contention and ensures strict order determinism. Vertical scaling (fast CPUs) handles typical throughput. Multi-threaded would require complex coordination and risk non-determinism.' },
    ],
    keyTakeaways: ['Single-threaded matching engine per symbol is the industry-standard approach — avoids all lock contention', 'Kafka provides both the real-time market data feed and the immutable audit log in one system', 'Pre-trade risk checks protect against erroneous orders before they reach the market'],
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
      { section: 'Redis Sorted Set', content: 'Core data structure: Redis ZADD leaderboard <score> <player_id>. Score = game points. ZREVRANGE leaderboard 0 9 WITHSCORES → top 10 players in O(log N + K). ZREVRANK leaderboard <player_id> → player\'s rank in O(log N).' },
      { section: 'Score Updates', content: 'On game event, call ZADD leaderboard NX (new player) or ZINCRBY leaderboard <delta> <player_id> (score increment). Both O(log N). Redis handles millions of updates/sec. Score changes immediately visible in ZRANGE queries.' },
      { section: 'Neighborhood Queries', content: 'Show players above and below a specific rank: first ZREVRANK to get rank R, then ZREVRANGE leaderboard (R-5) (R+5) WITHSCORES to get 11 surrounding players. Two O(log N) operations.' },
      { section: 'Friend Leaderboard', content: 'Store friends as a Redis Set per player. To compute friend leaderboard: ZUNIONSTORE temp_key 1 leaderboard WEIGHTS 1 AGGREGATE MAX using player IDs filtered by friend list. Or: fetch all friend scores with ZSCORE and rank client-side (feasible for friend lists < 1000).' },
      { section: 'Persistence & Sharding', content: 'Redis RDB snapshots + AOF for persistence. For >1B players: shard by game_id or player_id range across multiple Redis instances. Consistent hashing for shard routing. Each shard holds a subset of the global leaderboard — cross-shard merge needed for global top-N.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        Player[Player Client]
        Spectator[Spectator UI]
        GameServer[Game Server]
        Esports[Esports Broadcast]
    end
    subgraph Edge
        direction TB
        CDN[Edge Cache Top N]
        LB[Load Balancer]
    end
    subgraph Gateway
        direction TB
        APIGW[Leaderboard API]
        Auth[Auth Service]
    end
    subgraph Services
        direction TB
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
        direction TB
        AOF[AOF Persistence]
        SnapshotJob[RDB Snapshot Job]
        SeasonRollover[Season Rollover Job]
        MergeTopN[Cross Shard Top N Merger]
    end
    subgraph Storage
        direction TB
        RedisShard1[(Redis ZSET Shard 1)]
        RedisShard2[(Redis ZSET Shard 2)]
        RedisShardN[(Redis ZSET Shard N)]
        FriendDB[(Friends Graph DB)]
        SeasonArchive[(Past Seasons Archive)]
        PlayerDB[(Player Profile DB)]
    end
    subgraph Analytics
        direction TB
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

    Player ~~~ CDN ~~~ APIGW ~~~ ScoreSvc ~~~ AOF ~~~ RedisShard1 ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class RedisShard1,RedisShard2,RedisShardN,FriendDB,SeasonArchive,PlayerDB storage
    class AOF,SnapshotJob,SeasonRollover,MergeTopN async
    class CDN,LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Redis sorted set vs DB ORDER BY rank', rationale: 'Redis ZREVRANK is O(log N) — microseconds for 100M players. SQL ORDER BY with RANK() requires a full scan or expensive index. Redis is the clear winner for real-time leaderboards.' },
    ],
    keyTakeaways: ['Redis sorted sets (ZSET) provide O(log N) rank queries on 100M players — the perfect data structure for leaderboards', 'ZINCRBY enables atomic score increments without race conditions', 'For cross-shard global top-N, merge top-K from each shard and take the global top-N'],
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
      { section: 'Continuous Batching', content: 'Naïve static batching waits for a full batch before running — wastes GPU cycles when sequences finish at different times. Continuous batching (vLLM-style) inserts new requests into the batch the moment a slot frees. GPU utilisation jumps from ~30% to >70%. Each iteration of the forward pass processes a mixed batch of prefill (first token) and decode (subsequent tokens) steps.' },
      { section: 'KV Cache Management', content: 'The key-value attention cache grows with sequence length and is the primary GPU memory bottleneck. PagedAttention (vLLM) manages KV cache in fixed-size blocks analogous to OS virtual memory pages, eliminating fragmentation. This allows 2–4× more concurrent requests per GPU. When GPU memory is exhausted, swap least-recently-used KV blocks to CPU RAM.' },
      { section: 'Model Parallelism', content: 'A 70B parameter model does not fit on a single A100 (80GB). Tensor parallelism splits each weight matrix across N GPUs — each GPU holds 1/N of every layer and uses all-reduce after each layer. Pipeline parallelism assigns consecutive layers to different GPUs — lower communication overhead but introduces pipeline bubbles. Typical: tensor parallel across 4–8 GPUs within a node, pipeline parallel across nodes.' },
      { section: 'Request Routing & Queuing', content: 'API Gateway authenticates API keys, checks rate limits (token bucket in Redis), and routes to the correct model cluster. A scheduler queue (Redis or Kafka) holds pending requests. The inference scheduler pulls from the queue and bins-packs requests by sequence length to minimise padding waste. Streaming responses are sent back via SSE (Server-Sent Events) or WebSocket.' },
      { section: 'Observability & Cost', content: 'Token counters per API key feed the billing system (token-in × price_in + token-out × price_out). GPU utilisation, queue depth, and time-to-first-token are key SLIs. Auto-scaling triggers on queue depth: if queue grows > 100 requests, spin up another inference pod. Use spot/preemptible GPUs for non-latency-sensitive batch workloads.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        DevA[Developer App]
        ChatUI[Chat UI]
        Batch[Batch Inference Job]
    end
    subgraph Edge
        direction TB
        LB[Global Load Balancer]
        SSE[SSE and WebSocket Streaming]
    end
    subgraph Gateway
        direction TB
        APIGW[API Gateway]
        Auth[API Key Auth]
        TokenBucket[Token Bucket Rate Limit Redis]
        ModelRouter[Model Cluster Router]
    end
    subgraph Services
        direction TB
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
        direction TB
        Queue[Request Queue Redis or Kafka]
        Meter[Usage Metering Aggregator]
        Autoscaler[GPU Pod Autoscaler]
        SpotBatch[Spot GPU Batch Pool]
        WarmUp[Model Warmup Loader]
    end
    subgraph Storage
        direction TB
        KVCache[(KV Cache GPU HBM)]
        CPUSwap[(CPU RAM KV Swap)]
        ModelWeights[(Model Weights NFS or S3)]
        BillingDB[(Billing and Usage DB)]
        RateLimitRedis[(Rate Limit Redis)]
    end
    subgraph Analytics
        direction TB
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

    DevA ~~~ LB ~~~ APIGW ~~~ Scheduler ~~~ Queue ~~~ KVCache ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class KVCache,CPUSwap,ModelWeights,BillingDB,RateLimitRedis storage
    class Queue,Meter,Autoscaler,SpotBatch,WarmUp async
    class LB,SSE edge
    class EventBus,Metrics,Dash analytics`,
    tradeoffs: [
      { decision: 'Continuous batching vs static batching', rationale: 'Static batching is simpler but GPU sits idle waiting for the slowest sequence. Continuous batching is complex to implement but is required to hit >70% GPU utilisation in production.' },
      { decision: 'Tensor parallelism vs pipeline parallelism', rationale: 'Tensor parallelism has lower latency (no pipeline bubbles) but higher per-layer communication cost. Pipeline parallelism reduces communication but adds latency. Tensor parallel is preferred within a single NVLink-connected node.' },
    ],
    keyTakeaways: ['Continuous batching + PagedAttention are the two key techniques that make production LLM serving economically viable', 'Time-to-first-token and tokens-per-second are the primary latency SLIs — they have very different bottlenecks (prefill vs decode)', 'Model sharding strategy depends on the model size relative to available GPU memory and the NVLink/InfiniBand topology'],
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
      { section: 'Document Ingestion Pipeline', content: 'Ingestion is async: documents enter a queue (Kafka). Workers parse each format (PDF → Apache Tika, HTML → BeautifulSoup), then chunk into ~512-token passages with 50-token overlap between chunks (overlap preserves context across chunk boundaries). Each chunk is embedded using a sentence embedding model (e.g. text-embedding-3-large). Chunk metadata (doc_id, page, section, ACL tags) stored alongside the vector.' },
      { section: 'Chunking Strategy', content: 'Fixed-size chunking is simple but splits sentences mid-thought. Prefer semantic chunking: split on paragraph/section boundaries, then sub-split only if a section exceeds the token limit. Hybrid chunk sizes: store both a small chunk (128 tokens, high precision) and the parent section (512 tokens, high recall). At retrieval time, fetch the small chunk for ranking but return the parent for context — the "parent document retriever" pattern.' },
      { section: 'Vector Retrieval', content: 'Store vectors in a vector database (Pinecone, Weaviate, or pgvector). At query time: (1) embed the user question with the same model, (2) run ANN search to get top-50 candidates (HNSW index, cosine similarity), (3) apply metadata filters for access control — only return chunks whose ACL tags include the requesting user\'s groups. Metadata filtering before ANN avoids leaking restricted documents.' },
      { section: 'Re-ranking', content: 'ANN retrieval optimises for embedding similarity, which is a proxy for relevance. A cross-encoder re-ranker (e.g. Cohere Rerank, a fine-tuned BERT) takes the query + each candidate chunk and scores them jointly — much more accurate than bi-encoder similarity but too slow to run on all documents. Run re-ranker on the top-50 ANN results, return top-5. Adds ~100ms but significantly improves answer quality.' },
      { section: 'LLM Context Assembly & Prompting', content: 'Assemble a prompt: system instructions + top-5 retrieved passages (each labelled [Source 1], [Source 2]…) + user question. Ask the LLM to answer using only the provided sources and cite them. If no source is relevant, instruct the model to say so rather than hallucinate. Stream the response. Post-process to extract citation markers and map them to doc metadata for the UI.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        WikiSync[Wiki Sync Connector]
        SlackSync[Slack Connector]
        PDFUpload[PDF Upload]
        AskUser[Asking User]
        AdminUI[Admin Console]
    end
    subgraph Edge
        direction TB
        LB[Load Balancer]
    end
    subgraph Gateway
        direction TB
        QueryAPI[Query API]
        IngestAPI[Ingest API]
        Auth[Auth and ACL Resolver]
    end
    subgraph Services
        direction TB
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
        direction TB
        Kafka[Ingestion Queue Kafka]
        EmbedWorker[Embedding Worker Pool]
        ReindexJob[Reindex on Update Job]
        EvalJob[Eval and Recall Monitor]
        DeleteJob[Tombstone Cleanup]
    end
    subgraph Storage
        direction TB
        VectorDB[(Vector DB HNSW)]
        DocStore[(Doc Store S3)]
        MetaDB[(Chunk Metadata DB)]
        ACLStore[(ACL Tags Store)]
        AnswerKV[(Answer Cache Redis)]
        FeedbackDB[(Feedback DB)]
    end
    subgraph Analytics
        direction TB
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

    WikiSync ~~~ LB ~~~ QueryAPI ~~~ Parser ~~~ Kafka ~~~ VectorDB ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class VectorDB,DocStore,MetaDB,ACLStore,AnswerKV,FeedbackDB storage
    class Kafka,EmbedWorker,ReindexJob,EvalJob,DeleteJob async
    class LB edge
    class EventBus,Lake analytics`,
    tradeoffs: [
      { decision: 'Bi-encoder ANN vs cross-encoder for retrieval', rationale: 'Bi-encoder (ANN) is O(1) against a pre-built index — milliseconds for millions of vectors. Cross-encoder is O(N) — only feasible on the small candidate set. Two-stage pipeline gives the best of both.' },
      { decision: 'Chunk size', rationale: 'Smaller chunks (128 tokens) improve precision (less irrelevant text per chunk) but may lose context. Larger chunks (1024 tokens) improve recall but dilute the relevance signal. The parent document retriever pattern decouples the two concerns.' },
    ],
    keyTakeaways: ['Two-stage retrieval (ANN + re-ranker) is the standard production pattern — pure vector search has insufficient precision for high-stakes answers', 'Access control must be enforced at the vector-search layer via metadata filters, not just at document fetch time', 'Chunking strategy has an outsized effect on answer quality — semantic chunking with parent retrieval outperforms naive fixed-size splitting'],
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
      { section: 'Feature Registry', content: 'Central metadata store where data scientists declare feature groups in code (Python SDK). Each feature definition specifies: source (table/query/Kafka topic), entity key (e.g. user_id), transformation logic, and freshness SLA. The registry is the single source of truth — enforces naming conventions, tracks ownership, and powers the data catalogue. Stored in a relational DB.' },
      { section: 'Offline Store', content: 'Historical feature values stored in a columnar format (Parquet on S3, or BigQuery/Snowflake). Batch materialisation jobs (Spark) run on a schedule, reading from the data warehouse and writing feature values partitioned by entity and date. Training data generation performs a point-in-time correct join: for each training example with label timestamp T, fetch the feature values that were available at time T — preventing label leakage from future data.' },
      { section: 'Online Store', content: 'Low-latency key-value store (Redis) holds the latest feature value per entity. Schema: key = entity_id, value = hash of {feature_name: value}. Batch materialisation jobs also write to Redis after writing to the offline store. Multiple features for one entity are fetched in a single HGETALL — one round-trip. Serialisation: Protocol Buffers or MessagePack for compactness.' },
      { section: 'Streaming Materialisation', content: 'For features that must be fresh within minutes (e.g. "user click count in last 10 minutes"), a streaming pipeline (Flink or Spark Streaming) consumes the source Kafka topic, applies the transformation (windowed aggregation), and writes results to the online store in real time. Streaming features co-exist with batch features under the same entity key in Redis.' },
      { section: 'Serving SDK & Consistency', content: 'Model inference code calls feature_store.get_online_features(entity_ids, feature_names). The SDK batches multiple entity lookups into a single Redis pipeline call. A common footgun: training used offline features; inference uses online features — if the two materialisation pipelines apply transformations differently, training-serving skew silently degrades model performance. The fix: share transformation logic in a single feature transformation library used by both pipelines.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        DataSci[Data Scientist]
        TrainingPipeline[Model Training Pipeline]
        InferenceSvc[Online Inference Service]
        DataCatalog[Data Catalog UI]
    end
    subgraph Gateway
        direction TB
        SDK[Feature Store SDK]
        RegistryAPI[Feature Registry API]
    end
    subgraph Services
        direction TB
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
        direction TB
        SparkBatch[Spark Batch Job]
        FlinkStream[Flink Streaming Job]
        Backfill[Backfill Job]
        FreshnessMon[Feature Freshness Monitor]
        SkewDetector[Training Serving Skew Detector]
    end
    subgraph Storage
        direction TB
        DW[(Data Warehouse Snowflake)]
        OfflineStore[(Offline Store S3 Parquet)]
        OnlineStore[(Online Store Redis)]
        MetaDB[(Registry Metadata DB)]
        LineageDB[(Lineage DB)]
    end
    subgraph Analytics
        direction TB
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

    DataSci ~~~ SDK ~~~ Registry ~~~ SparkBatch ~~~ DW ~~~ Kafka

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class DW,OfflineStore,OnlineStore,MetaDB,LineageDB storage
    class SparkBatch,FlinkStream,Backfill,FreshnessMon,SkewDetector async
    class Kafka,EventBus,Dash analytics`,
    tradeoffs: [
      { decision: 'Separate online vs offline stores vs unified', rationale: 'A single store (e.g. DynamoDB for both) simplifies consistency but cannot simultaneously serve petabyte-scale historical scans and sub-10ms point reads. Separate stores optimised for their access patterns are the industry standard (Feast, Tecton, Hopsworks all use this split).' },
      { decision: 'Push vs pull materialisation to online store', rationale: 'Push (pipeline writes to Redis on each update) gives low latency but complexity. Pull (inference service reads from the warehouse on demand) is simpler but too slow for < 10ms SLA. Push materialisation is required for online serving.' },
    ],
    keyTakeaways: ['Point-in-time correctness in training data joins is the most common source of training-serving skew — the feature store must handle this automatically', 'Sharing transformation logic between batch and streaming pipelines eliminates the most dangerous class of skew bugs', 'Redis HGETALL fetches all features for an entity in one round-trip — critical for keeping online latency under 10ms'],
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
      { section: 'Job Submission & Scheduling', content: 'Data scientist submits a job via CLI/SDK specifying: Docker image, entry-point command, resource request (N GPUs, memory, CPU), priority, and dataset path. The scheduler (built on Kubernetes + a gang-scheduling plugin like Volcano) places the job when enough nodes are free. Gang scheduling is critical: a distributed training job needs ALL N nodes simultaneously — partial allocation causes deadlock. Priority queues ensure high-priority jobs preempt lower-priority ones.' },
      { section: 'Distributed Training', content: 'The platform injects environment variables (MASTER_ADDR, WORLD_SIZE, RANK) so the training code can initialise PyTorch DDP (Distributed Data Parallel) or FSDP (Fully Sharded Data Parallel) without platform-specific code. DDP: each GPU holds a full model copy, gradients all-reduced after each backward pass — standard for models that fit in single-GPU memory. FSDP: shards model parameters, gradients, and optimiser state across GPUs — required for 10B+ parameter models. The platform also sets up NCCL (NVIDIA Collective Communications Library) for high-bandwidth GPU-to-GPU communication over InfiniBand.' },
      { section: 'Experiment Tracking', content: 'A lightweight SDK call (mlflow.log_metric, mlflow.log_param) inside training code sends hyperparameters and metrics to the tracking server. The tracking server writes to a relational DB (PostgreSQL). Large artefacts (model checkpoints, plots) are written to S3 with the path recorded in the DB. The UI provides run comparison, metric charts over time, and artefact browsing. Runs are grouped under experiments and can be tagged for easy filtering.' },
      { section: 'Model Registry', content: 'After a training run, the data scientist registers the best checkpoint to the model registry: a versioned catalogue of trained models. Each version records: training run ID (lineage back to code + data + hyperparameters), evaluation metrics, and a lifecycle stage (None → Staging → Production → Archived). The inference platform reads model URIs from the registry to deploy — decoupling training from serving and enabling safe rollbacks.' },
      { section: 'Fault Tolerance & Checkpointing', content: 'Long training runs (days on 512 GPUs) are expensive to restart from scratch. The platform periodically saves checkpoints to S3 (every N steps). On node failure, the job is automatically restarted from the latest checkpoint. Spot/preemptible instance interruptions are handled via a "checkpoint on SIGTERM" signal handler injected by the platform. Elastic training (PyTorch Elastic) allows a job to continue with fewer nodes after a failure rather than full restart.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        DataSci[Data Scientist]
        CLI[CLI and SDK]
        Notebook[Jupyter Notebook]
        InferencePlatform[Inference Platform]
    end
    subgraph Gateway
        direction TB
        JobAPI[Job Submit API]
        Auth[Auth and Quota Service]
        UI[Web UI]
    end
    subgraph Services
        direction TB
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
        direction TB
        CheckpointJob[Periodic Checkpoint Saver]
        SpotInterrupt[Spot Preempt Handler]
        ArtifactGC[Old Artifact GC]
        MetricsAgg[Metrics Aggregator]
        BillingAgg[GPU Hours Billing]
    end
    subgraph Storage
        direction TB
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
        direction TB
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

    DataSci ~~~ JobAPI ~~~ Scheduler ~~~ CheckpointJob ~~~ GPUPoolA100 ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class ArtifactS3,CheckpointS3,RunDB,ModelRegistryDB,DatasetCatalog storage
    class CheckpointJob,SpotInterrupt,ArtifactGC,MetricsAgg,BillingAgg async
    class EventBus,Dash analytics`,
    tradeoffs: [
      { decision: 'Gang scheduling vs best-effort scheduling', rationale: 'Best-effort partial allocation causes distributed jobs to hang waiting for remaining nodes — wasting the allocated GPUs. Gang scheduling guarantees all-or-nothing allocation, eliminating deadlock at the cost of some scheduler complexity and potential head-of-line blocking by large jobs.' },
      { decision: 'DDP vs FSDP', rationale: 'DDP is simpler and has lower communication overhead (only gradients are communicated), but requires the full model to fit in each GPU\'s memory. FSDP shards everything, enabling training of models 4–8× larger, at the cost of higher communication volume and implementation complexity.' },
    ],
    keyTakeaways: ['Gang scheduling is non-negotiable for distributed training — partial allocation causes silent deadlocks that waste expensive GPU hours', 'FSDP/ZeRO-style sharding is the standard technique for training models that exceed single-GPU memory', 'The model registry creates the critical audit trail linking a deployed model back to its exact training code, dataset version, and hyperparameters'],
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
      { section: 'HNSW Index', content: 'Hierarchical Navigable Small World (HNSW) is the dominant ANN algorithm for high recall + low latency. It builds a multi-layer graph: the top layer is sparse (long-range links for fast traversal), lower layers are dense (short-range links for precision). Query: start at the top layer, greedily navigate towards the query vector, descend to the next layer at the entry point, repeat until layer 0. Search is O(log N) in practice. Construction is O(N log N) — expensive but done once offline. ef_construction and M hyperparameters trade index build time / memory vs recall.' },
      { section: 'Quantisation', content: 'Full float32 vectors (1B × 1536 × 4B = 6 TB) cannot fit in RAM for fast access. Product Quantisation (PQ) compresses each vector by splitting into sub-vectors and replacing each with a codebook index. 96× compression (float32 → 1-byte code per sub-vector) at ~5% recall cost. HNSW graph traversal uses quantised vectors for candidate selection; the final top-K re-scoring fetches the original float32 vectors for accuracy. Scalar quantisation (float32 → int8) gives 4× compression with minimal recall loss and is now the default in most production systems.' },
      { section: 'Metadata Filtering', content: 'Two strategies for combining vector search with metadata filters. Pre-filtering: apply the metadata filter first (from an inverted index), then run ANN only on the filtered subset — accurate but slow if the filter is selective (ANN on 1K vectors loses graph efficiency). Post-filtering: run ANN on all vectors, then discard results that fail the filter — fast but can return fewer than K results if the filter is selective. Production systems use a hybrid: if filter selectivity > threshold, use a filtered HNSW traversal (only traverse nodes matching the filter); otherwise fall back to post-filter.' },
      { section: 'Distributed Architecture', content: 'Shard vectors across nodes by ID range or consistent hashing. Each shard holds a full HNSW index for its vectors. At query time, the query is broadcast to all shards (scatter); each shard returns its local top-K; the coordinator merges and re-ranks the global top-K (gather). Replication factor of 3 for read availability and fault tolerance. Writes go to a primary shard; the primary updates its HNSW index and replicates asynchronously to replicas.' },
      { section: 'Real-time Upserts', content: 'HNSW does not support efficient incremental deletes — deleting from the graph requires re-linking neighbours. Solution: mark deleted vectors with a tombstone (skip during traversal). Periodically compact the index offline to physically remove tombstones. New vectors are inserted into the graph immediately (HNSW supports online inserts in O(log N)). To handle the delay between upsert and index refresh on replicas, the client SDK can fall back to a brute-force scan of a small "dirty buffer" of recent upserts not yet in the main index.' },
    ],
    diagram: `graph LR
    subgraph Clients
        direction TB
        RAGApp[RAG Application]
        ImageSearch[Image Similarity App]
        RecSys[Recommendation System]
        AdminUI[Admin UI]
    end
    subgraph Edge
        direction TB
        LB[Load Balancer]
    end
    subgraph Gateway
        direction TB
        APIGW[Vector DB API]
        Auth[Auth and Namespace ACL]
    end
    subgraph Services
        direction TB
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
        direction TB
        BuilderJob[HNSW Index Builder]
        CompactJob[Tombstone Compaction]
        TrainingJob[PQ Codebook Trainer]
        ReplLag[Replica Sync]
        DirtyBufferGC[Dirty Buffer Flush]
    end
    subgraph Storage
        direction TB
        VectorsRaw[(Raw float32 Vectors)]
        QuantVectors[(Quantized int8 Vectors)]
        HNSWGraph[(HNSW Graph Edges)]
        MetaIdx[(Metadata Inverted Index)]
        Tombstones[(Tombstone Log)]
        DirtyBuffer[(Dirty Upsert Buffer)]
        NamespaceMeta[(Namespace Registry)]
    end
    subgraph Analytics
        direction TB
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

    RAGApp ~~~ LB ~~~ APIGW ~~~ Coordinator ~~~ BuilderJob ~~~ VectorsRaw ~~~ EventBus

    classDef storage fill:#1e3a5f,stroke:#3b82f6,color:#dbeafe
    classDef async fill:#3b0764,stroke:#a855f7,color:#f3e8ff
    classDef edge fill:#14532d,stroke:#22c55e,color:#dcfce7
    classDef analytics fill:#713f12,stroke:#eab308,color:#fef9c3
    class VectorsRaw,QuantVectors,HNSWGraph,MetaIdx,Tombstones,DirtyBuffer,NamespaceMeta storage
    class BuilderJob,CompactJob,TrainingJob,ReplLag,DirtyBufferGC async
    class LB edge
    class EventBus,Metrics analytics`,
    tradeoffs: [
      { decision: 'HNSW vs IVF (Inverted File Index)', rationale: 'HNSW gives higher recall at low latency with no training step, but uses more memory (graph edges). IVF clusters vectors into centroids (requires k-means training), then searches only nearby clusters — lower memory, easier to shard, but slightly lower recall and requires retraining when the distribution shifts. HNSW dominates for online serving; IVF+PQ is preferred for billion-scale offline batch search.' },
      { decision: 'Pre-filtering vs post-filtering for metadata', rationale: 'Post-filtering is simple but fails on selective filters (returns too few results). Pre-filtering with a filtered HNSW traversal is accurate but requires the metadata index to be co-located with the vector index, increasing implementation complexity. Most production systems use a selectivity-based routing heuristic.' },
    ],
    keyTakeaways: ['HNSW provides O(log N) query time with high recall but requires the graph to fit in memory — quantisation is essential at billion-vector scale', 'Scatter-gather across shards is the standard distributed query pattern; the coordinator merges per-shard top-K lists into the global result', 'Metadata filtering and ANN search are fundamentally at odds — the routing strategy between pre/post/filtered-traversal is the core design decision for a production vector DB'],
  },
];
