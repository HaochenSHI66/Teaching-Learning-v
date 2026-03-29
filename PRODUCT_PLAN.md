# Product Plan: PPT Learning Assistant
**Status**: Draft
**Author**: Product Assessment for Solo Dev
**Date**: 2026-03-23
**Audience**: Solo developer (PolyU computing student)

---

## Executive Summary

You have a surprisingly complete product for a student project. The codebase has JWT auth, multi-tenant data models (`user_id` on core tables), rate limiting, cost tracking, Docker Compose with PostgreSQL, and a rich feature set (explanations, knowledge graph, flashcards with SM-2, quizzes, chat). This is not "works on my laptop" -- this is "80% of the way to deployable."

The remaining 20% is entirely about hardening, not features. Do not build anything new until 50 real users are on it.

---

## 1. MVP Checklist: "Works on My Laptop" to "50 Real Users"

### MUST DO before any user touches it (Week 1-2)

**Security -- non-negotiable:**

- [ ] **Change JWT_SECRET from "dev-secret-change-in-production".** Your `auth.py` line 12 literally says this. Generate a random 64-char secret: `python3 -c "import secrets; print(secrets.token_hex(32))"`. Store it ONLY in env vars, never in code.
- [ ] **Lock down CORS_ORIGINS.** Your `.env` has `CORS_ORIGINS=http://127.0.0.1:3000`. Change to your actual production domain. The `allow_origins=["*"]` fallback in `main.py` line 60 is dangerous -- remove the `or ["*"]` fallback entirely.
- [ ] **Enforce auth on all data endpoints.** Your `get_optional_user` pattern means endpoints work without auth. Audit every router: any endpoint that reads/writes user data MUST use `get_current_user` (not `get_optional_user`). Data leakage between users is a product-killing bug.
- [ ] **Add file upload validation.** Your document upload must reject non-PDF/PPT files, enforce a max file size (50MB is reasonable), and validate the file content matches the declared media type. A malicious upload could consume all your disk or worse.
- [ ] **Set the PostgreSQL password to something real.** `teaching_pass` in docker-compose.yml is not a password.

**Reliability -- prevents "it crashed and I lost my data" support tickets:**

- [ ] **Switch frontend Dockerfile from `npm run dev` to `npm run build && npm start`.** Your production Dockerfile runs Next.js in dev mode. This is slower, shows error stack traces to users, and uses more memory. Change `CMD` to: `RUN npm run build` then `CMD ["npm", "start"]`.
- [ ] **Add a health check endpoint for the frontend.** Backend has `/health`. Frontend needs one too for Docker restart policies.
- [ ] **Set up automated database backups.** With PostgreSQL: a daily `pg_dump` cron job that writes to a separate volume or uploads to object storage. Losing user data = losing all users permanently.
- [ ] **Add basic error handling on the LLM API calls.** DashScope will go down. Your explanation generation should retry once, then fail gracefully with a user-visible "try again in a moment" message, not a 500 error.
- [ ] **Test with 5 concurrent users.** Have 5 friends upload PDFs simultaneously. Find the bottleneck before real users do.

**UX -- the minimum for users to not immediately bounce:**

- [ ] **Add a landing/login page.** Users need to know what this is before creating an account.
- [ ] **Add loading states for LLM-generated content.** Explanation generation takes seconds. Without a loading indicator, users will think it's broken and click again (doubling your API cost).
- [ ] **Add error toasts.** When something fails (upload, generation, save), the user needs to see a clear message, not a silent failure.
- [ ] **Test the full flow end-to-end on a clean account.** Register, upload a real 30-slide PPT, generate explanations, use flashcards, take a quiz. Fix every rough edge.

### SHOULD DO before scaling to 50 users (Week 3-4)

- [ ] **Add per-user storage quotas.** Without this, one user could upload 500 PDFs and fill your disk. Start with 500MB per user / 20 documents max.
- [ ] **Add per-user daily LLM call limits.** Your rate limiter is per-minute. Add a daily cap (e.g., 100 explanation generations/day) to prevent cost surprises.
- [ ] **Set up basic logging.** Structured JSON logs from the backend with request_id, user_id, endpoint, latency. When something breaks at 2am, you need to know what happened without SSH-ing in.
- [ ] **Add a simple admin view.** Even a CLI script that shows: total users, documents uploaded today, LLM cost today, error count. You need visibility.
- [ ] **Write a 1-page "How to Use" guide.** In-app or a linked Google Doc. Students will not read a long manual, but they need to know the basic flow.

### NICE TO HAVE (do NOT touch until you have 50+ active users)

- Social features (sharing notes, study groups)
- Additional LLM providers
- Mobile optimization
- Gamification
- Export to Anki

---

## 2. Deployment Architecture (<$20/month)

### Recommended: Single VPS with Docker Compose

**Provider**: Hetzner Cloud CX22 (2 vCPU, 4GB RAM, 40GB disk) -- approximately EUR 5.49/month (~$6 USD, ~47 HKD).

Alternatively: Oracle Cloud Free Tier (ARM, 4 CPU, 24GB RAM, 200GB disk) -- literally free. Less reliable, but the price is right.

**Architecture:**

```
[Cloudflare DNS + CDN (free)] --> [Your VPS]
                                    |
                              [nginx reverse proxy]
                                    |
                    +---------------+---------------+
                    |               |               |
              [Next.js:3000]  [FastAPI:8000]  [PostgreSQL:5432]
                    |               |
              [built static]  [./storage volume]
```

**Why this works for 50 users:**
- 50 university students will not be concurrent. Realistic peak: 5-10 simultaneous users.
- FastAPI + uvicorn handles this trivially on 2 vCPU.
- PostgreSQL with 4GB RAM is overkill for this scale.
- The bottleneck is DashScope API latency, not your server.

**Setup steps:**

1. Get a Hetzner CX22 (or Oracle free tier).
2. Install Docker + Docker Compose.
3. Add nginx as a reverse proxy with SSL (use Caddy instead of nginx if you want auto-SSL with zero config).
4. Point your domain (buy one: ~$10/year on Cloudflare or Namecheap).
5. Deploy your existing docker-compose.yml with these changes:

```yaml
# Changes to docker-compose.yml for production:
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on:
      - frontend
      - backend

  backend:
    # ... existing config ...
    environment:
      - DATABASE_URL=postgresql://teaching:REAL_SECURE_PASSWORD@postgres:5432/teaching_learning
      - JWT_SECRET=YOUR_64_CHAR_RANDOM_SECRET
      - CORS_ORIGINS=https://yourdomain.com
    # Remove port exposure (Caddy handles external access):
    # ports:
    #   - "8000:8000"

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.prod  # New file, see below
    # Remove port exposure:
    # ports:
    #   - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_BASE_URL=https://yourdomain.com
```

```
# Caddyfile (entire file):
yourdomain.com {
    handle /api/* {
        reverse_proxy backend:8000
    }
    handle /storage/* {
        reverse_proxy backend:8000
    }
    handle {
        reverse_proxy frontend:3000
    }
}
```

```dockerfile
# frontend/Dockerfile.prod
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
```

**Monthly cost breakdown:**
| Item | Cost |
|------|------|
| Hetzner CX22 | ~$6/month |
| Domain name | ~$1/month (amortized) |
| Cloudflare DNS/CDN | Free |
| DashScope API (50 users, ~200 pages each/month = 10k pages) | ~200 CNY (~$28) |
| **Total** | **~$35/month** |

**Honest note:** The LLM API cost is your biggest expense, not infrastructure. At 0.02 CNY/page with 50 active users doing ~200 pages/month, that is 200 CNY (~$28 USD). This is above your $20 budget. Options:
- Cap free tier at 100 pages/month per user (brings cost to ~100 CNY).
- Charge a small fee (see pricing section).
- Both -- free tier with cap + paid tier with higher cap.

### Backup strategy (critical):

```bash
# Add to crontab on VPS:
# Daily PostgreSQL backup at 3am
0 3 * * * docker exec postgres pg_dump -U teaching teaching_learning | gzip > /backups/db_$(date +\%Y\%m\%d).sql.gz
# Keep last 14 days
0 4 * * * find /backups -name "db_*.sql.gz" -mtime +14 -delete
```

---

## 3. Legal and Compliance

### Copyright (course slides) -- the real risk

**The situation:** Students upload copyrighted lecture slides created by PolyU professors. You store them on your server and process them with a third-party API (DashScope).

**Risk level: Medium.** Here is the honest breakdown:

**What protects you:**
- Hong Kong Copyright Ordinance (Cap. 528) has a "fair dealing for education" exception (Section 41A). Personal study use of copyrighted materials is generally permitted.
- You are not redistributing the slides -- each user uploads their own copy and only they can access it.
- This is analogous to a student taking photos of lecture slides and using a study tool on them.

**What could cause problems:**
- If users can share slides with each other, you become a distribution platform. DO NOT build sharing features for slides.
- If DashScope stores or trains on the uploaded content, you may be facilitating unauthorized copying. Check DashScope's data processing terms -- you need confirmation that uploaded images are not retained or used for training.
- If a professor or university explicitly complains, you should comply immediately (take-down).

**Action items:**
- [ ] Add Terms of Service stating users may only upload materials they have legitimate access to.
- [ ] Add a clear statement: "Uploaded materials are for your personal study use only and are not shared with other users."
- [ ] Read DashScope's API terms of service regarding data retention. If they retain uploaded images, document this in your privacy policy.
- [ ] Implement per-user data isolation so there is zero possibility of cross-user slide access. Your `user_id` field exists but `get_optional_user` means some endpoints might not enforce it.
- [ ] Build a simple admin ability to delete a user's content upon request.

### Data Privacy (PDPO)

Hong Kong's Personal Data (Privacy) Ordinance (PDPO) applies to you even as a student project if you collect personal data.

**What you collect:** Email, display name, usage data, uploaded documents.

**Required actions:**
- [ ] Write a Privacy Policy (1-2 pages). Must cover: what data you collect, why, who you share it with (DashScope), how long you keep it, how users can request deletion.
- [ ] Add a privacy policy link to your registration page.
- [ ] Implement a "delete my account and all data" feature. Under PDPO, users have the right to request erasure.
- [ ] Do NOT collect unnecessary data. You do not need phone numbers, student IDs, or real names.

**DashScope / Alibaba Cloud consideration:**
- Data is sent to mainland China servers. Mention this in your privacy policy.
- For HK students, this is generally acceptable for a study tool, but be transparent about it.

### Practical risk assessment:

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| University sends cease-and-desist | Low (if you stay small) | High | Comply immediately, have a takedown process |
| Professor complains about their slides | Medium | Medium | Remove content, add upload disclaimer |
| PDPO complaint | Very Low | Medium | Have privacy policy, offer data deletion |
| DashScope TOS violation | Low | Low | Read their terms, comply |

**Bottom line:** At 50 users, nobody is coming after you. At 5,000 users, a university might notice. Build the legal foundations now (ToS, privacy policy, data isolation) so you are not scrambling later.

---

## 4. Pricing Model

### Recommendation: Freemium with usage cap

**Do NOT charge money yet.** Here is why:
- You need users more than you need revenue right now.
- Setting up payment processing in HK (Stripe HK, or local alternatives) adds weeks of work.
- At 50 users, even if everyone paid $20/month, that is $1,000/month -- nice but not life-changing, and the friction of payment will kill your growth.

**Phase 1 (0-100 users): Free with limits**

| Feature | Free Tier |
|---------|-----------|
| Documents | 10 max |
| Pages processed/month | 100 |
| Storage | 200MB |
| Flashcards | Unlimited (no LLM cost) |
| Chat questions/day | 20 |
| Knowledge graph | Included |

This keeps your monthly LLM cost under 200 CNY (~$28 USD) even at 100 users.

Display a usage counter in the UI: "42/100 pages used this month." This creates awareness that the service costs money to run.

**Phase 2 (100+ users): Introduce paid tier**

| Feature | Free | Pro (HK$29/month) |
|---------|------|--------------------|
| Documents | 10 | 50 |
| Pages/month | 100 | 500 |
| Storage | 200MB | 2GB |
| Chat questions/day | 20 | Unlimited |
| Priority generation | No | Yes |

**Why HK$29/month (~$3.7 USD):**
- A bubble tea costs HK$30-45. This is "skip one drink" pricing.
- HK students routinely pay HK$50-100/month for Spotify, Netflix, etc.
- At HK$29 with 20% conversion, 100 users = HK$580/month -- covers your server and API costs.

**Payment method when ready:** Stripe HK (supports HK credit/debit cards, FPS). Alternatively, collect via PayMe / FPS manually for the first 10 paying users -- ugly but zero setup cost.

---

## 5. Marketing and Distribution Strategy

### Core insight: University students discover tools through 3 channels

1. **Word of mouth from classmates** (highest trust, highest conversion)
2. **Course-specific group chats** (WhatsApp/Telegram groups per course)
3. **Social media** (Instagram, Xiaohongshu for mainland students in HK)

### Phase 1: Seed users (Week 1-4, target: 10-20 users)

**Strategy: Personal network + specific courses**

- [ ] Pick 2-3 courses YOU are taking this semester. Use the tool for your own studying. This is your proof of value.
- [ ] Show it to 5 classmates in person. Watch them use it. Take notes on where they get confused.
- [ ] Ask each person who finds it useful to show one friend. Warm introductions beat any ad.
- [ ] Post in your course WhatsApp/Telegram groups: "I built a tool that explains PPT slides in Chinese, free to use, looking for feedback." Do NOT spam multiple groups -- start with courses where slides are dense and hard to understand (theory-heavy CS/engineering courses are ideal).

**What NOT to do:**
- Do not make an Instagram page yet. You have no users to create content about.
- Do not print flyers. The conversion rate is near zero.
- Do not post on Reddit/HN. Your target users are not there.

### Phase 2: Organic growth (Month 2-3, target: 50 users)

- [ ] Ask your best 5 users for a 1-paragraph testimonial. "What course did you use it for? How did it help?"
- [ ] Create a simple demo video (screen recording, 60 seconds). Upload a real PPT, show the Chinese explanation, show the knowledge graph. Post in Xiaohongshu with tags like #PolyU #study #revision.
- [ ] Identify 1-2 "connector" students (people who know everyone in a department). Give them early access to the paid tier for free in exchange for spreading the word.
- [ ] Target exam season (April-May). This is when demand for study tools peaks. Time your push for 2-3 weeks before exam period.

### Phase 3: Cross-university expansion (Month 4+, target: 200 users)

- [ ] Each university has different course structures. You need 1 seed user per university who will champion it in their group chats.
- [ ] HKU and CUHK have active Telegram study communities. Find them.
- [ ] If you reach 200 users, write a brief post for PolyU's student media or computing department newsletter.

### Distribution channels ranked by ROI for a solo dev:

| Channel | Effort | Expected Users | Timeline |
|---------|--------|---------------|----------|
| Personal classmates | Very Low | 5-10 | Week 1 |
| Course group chats | Low | 10-30 | Week 2-4 |
| Xiaohongshu demo video | Medium | 20-50 | Month 2 |
| Word-of-mouth referrals | Zero (organic) | Compounds | Ongoing |
| University forums/Telegram | Medium | 30-100 | Month 3+ |

---

## 6. Critical Risks and Mitigations

### Risk 1: LLM API cost spirals out of control
**Likelihood: High.** If a user uploads a 200-page PDF and generates all explanations, that is 4 CNY per document. 50 users doing this = 200 CNY without blinking.

**Mitigation:**
- Hard per-user monthly page limit (100 pages free tier). Enforce in backend.
- Add a confirmation dialog before bulk generation: "Generate explanations for 47 slides? This uses 47 of your 100 monthly credits."
- Monitor daily cost. Set a personal alert if daily spend exceeds 20 CNY.
- Cache explanations -- if the same slide is re-processed, serve the cached version.

### Risk 2: You burn out maintaining this during exam season
**Likelihood: High.** You are a student. Your exams and this product's peak demand happen at the same time.

**Mitigation:**
- Automate everything possible BEFORE exam season: deployment, backups, monitoring.
- Set expectations: put "Beta -- maintained by a solo student developer" on the landing page.
- Have a kill switch: if you need to focus on exams, you can set the app to read-only mode (disable new uploads/generation) without losing existing user data.
- Do not promise response times for bug reports. Use a simple GitHub Issues page or a Google Form.

### Risk 3: A single bad deployment takes the app down with no rollback
**Likelihood: Medium.** You are deploying to a single server with no staging environment.

**Mitigation:**
- Tag every deployment in git. Before deploying, note the current commit hash.
- Use `docker compose up -d --build` for deployments. If something breaks, `git checkout <previous-hash> && docker compose up -d --build`.
- Test the build locally before pushing to production. `docker compose build` should succeed with zero errors.
- Never deploy on a Friday or during exam week.

### Risk 4: DashScope API changes pricing or goes down
**Likelihood: Low-Medium.** Alibaba Cloud services are generally stable, but pricing can change.

**Mitigation:**
- Your backend already abstracts the LLM call behind configuration (API_KEY, BASE_URL, MODEL in .env). You can switch providers by changing 3 env vars.
- Keep an eye on alternatives: SiliconFlow, Moonshot, DeepSeek -- all offer cheap Chinese-language LLM APIs.
- Cache all generated content aggressively. If DashScope goes down, existing explanations still work.

### Risk 5: Nobody uses it
**Likelihood: Medium.** The most common failure mode for student projects.

**Mitigation:**
- Validate demand before investing more time. If you cannot get 10 classmates to use it for one week, the product has a problem.
- Watch WHAT users do, not what they say. If they upload slides but never return to read explanations, the explanations are not useful enough.
- The knowledge graph and flashcards are differentiators -- but only if they work well. Do not spread thin across 10 features. Make the core loop amazing: upload -> read explanation -> understand.
- Kill features that nobody uses. Check analytics after 30 days. If <10% of users touch the knowledge graph, deprioritize it.

### Risk 6: University IP or legal complaint
**Likelihood: Low at current scale.**

**Mitigation:**
- See Section 3 above. Have ToS, privacy policy, and a takedown process ready.
- Do not put "PolyU" in your product name or branding. Do not imply university endorsement.
- If a professor contacts you, respond within 24 hours and comply with removal requests.

---

## 7. Prioritized Action Plan (4-Week Sprint)

### Week 1: Security and Hardening
- Change JWT_SECRET, PostgreSQL password, CORS origins
- Audit auth enforcement on all endpoints
- Add file upload validation
- Create production Dockerfile for frontend
- Set up VPS + Docker Compose + Caddy

### Week 2: Reliability and Monitoring
- Add database backup cron
- Add error handling for LLM API failures
- Add basic logging (request_id, user_id, errors)
- Add per-user usage limits (pages/month, storage)
- Test with 5 concurrent users

### Week 3: User Experience and Legal
- Add landing page with login/register
- Add loading states and error toasts
- Write Terms of Service (1 page)
- Write Privacy Policy (1 page)
- Add "delete my account" feature
- End-to-end test the full flow

### Week 4: Launch and Learn
- Deploy to production
- Invite 10 classmates
- Watch them use it (in person if possible)
- Fix the top 3 issues they hit
- Set up a simple feedback mechanism (Google Form)

---

## 8. What NOT to Build (and Why)

| Feature Request | Why Not Now |
|-----------------|-------------|
| Mobile app | <50 users on web. Responsive CSS fixes are fine; a native app is months of work for unvalidated demand. |
| Multi-language support (beyond Chinese) | Your entire value prop is Chinese explanations for English slides. Do not dilute. |
| Social/sharing features | Sharing copyrighted slides creates legal risk. And "social study" features are a graveyard of unused code. |
| Anki export | Nice idea, but build it when users ask for it, not before. |
| Professor/admin dashboard | You have zero professors as users. Do not build for imaginary personas. |
| AI-powered study plans | Feature creep. The core loop (upload -> explain -> review) is not proven yet. |
| Payment system | Do not build until you have 50+ users who are hitting free tier limits and asking to pay. |

---

## Appendix: Quick Reference

### Key files that need production changes:
- `/backend/app/auth.py` line 12: JWT_SECRET default
- `/backend/app/main.py` line 60: CORS `["*"]` fallback
- `/frontend/Dockerfile`: dev mode CMD
- `/docker-compose.yml`: PostgreSQL password, port exposure
- `/.env`: empty API_KEY and BASE_URL

### One-liner deployment test:
```bash
docker compose build && docker compose up -d && sleep 10 && curl -s http://localhost:8000/health
```
If this returns `{"status":"ok"}`, your backend is alive.

### Cost monitoring query (run against PostgreSQL):
```sql
SELECT
  date_trunc('day', created_at) as day,
  count(*) as api_calls,
  sum(input_tokens) as total_input_tokens,
  sum(output_tokens) as total_output_tokens,
  sum(estimated_cost_cny) as total_cost_cny
FROM llmusage
GROUP BY 1
ORDER BY 1 DESC
LIMIT 14;
```
