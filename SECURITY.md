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

To be assessed in Phase 4, once `SPEC.md` Q-03 to Q-05 are answered.

| Threat | Applies when |
|---|---|
| Leaked provider or channel credentials (bot tokens, webhook URLs) | Always |
| Alert spoofing or tampered alert rules | Anyone but the PO can change rules |
| Unauthenticated access to rules, data or history | Stark exposes an API or UI (Q-05) |
| Cost abuse of paid APIs (data provider, model) | Paid plan (Q-03) or AI (Q-07) |
| Prompt injection from market news or other fetched text | AI reads external text (Q-07) |
| Redistribution of licensed market data | Alerts go beyond the PO (Q-03, Q-05) |

## 3. Audit

The first security review of the built system is MSAP audit A-1 (`SPEC.md` D-02), MSAP §16, before the first real
alert. Phase 4 threat modelling is a design review, not an MSAP audit.

## 4. Gaps

All controls beyond §1 are open until the scope is decided.
