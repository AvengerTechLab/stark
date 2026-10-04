# Stark — Security Baseline

Status: **no code, no attack surface yet.** This file records the rules that apply from the start and the threats
to design for once the scope is known (standard §8). Each control will name the file that implements it.

---

## 1. Rules in force now

| Rule | Where |
|---|---|
| No credential is printed, logged or committed; `.env` files are ignored, `.env.example` holds names only | `.gitignore`, `CLAUDE.md` §5 |
| Tests never call a real data provider, broker, channel or model; fakes only | `CLAUDE.md` §5 |
| No order placement without written PO approval and a human approval step | `CLAUDE.md` §4, standard §21 |
| Sending a real alert or spending paid API credits needs the PO's go-ahead | `CLAUDE.md` §6 |

## 2. Threats to design for

To be assessed in Phase 4. v1 has one user, the PO (`SPEC.md` D-10).

| Threat | Applies when |
|---|---|
| Leaked provider or channel credentials (Telegram bot token, LINE channel token, Discord webhook URL, Gmail OAuth client secret and refresh token, PostgreSQL password) | Always; four channels in v1.0 (D-09) |
| Alert spoofing or tampered alert rules | Anyone but the PO reaches Stark's interface (v1 must allow only the PO, D-10) |
| Telegram bot commands from someone other than the PO | The bot accepts commands (D-21); it must check the sender's chat ID |
| Unauthenticated access to rules, data or history | Stark exposes an API or UI; v1 needs single-owner authentication (D-10) |
| Cost abuse of paid APIs (data provider, model) | Paid data plan (D-08: free first) or AI (v1.2; budget set before v1.2, D-12) |
| Alert flood exhausting a channel's quota or rate limit | Always; LINE's free quota is small; LINE stops at the quota (D-17) |
| Prompt injection from market news or other fetched text | AI reads news, from v1.2 (`SPEC.md` D-06) |
| Redistribution of licensed market data | Alerts go beyond the PO (not in v1, D-10). Both terms allow personal, non-commercial use only (`ARCHITECTURE.md` §2.1) |

## 3. Audit

The first security review of the built system is MSAP audit A-1 (`SPEC.md` D-02), MSAP §16, before the first real
alert. Phase 4 threat modelling is a design review, not an MSAP audit.

## 4. Gaps

All controls beyond §1 are open until the scope is decided.
