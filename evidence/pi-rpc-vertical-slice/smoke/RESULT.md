# Pi RPC smoke (Windows)

status: passed

## Evidence
- probe.json — adapter=pi-rpc, capabilities=start,status,cancel,collect (no steer)
- rpc-lines.json — get_state + abort JSONL responses (strict LF framing)
- PROMPT-ROUNDTRIP.md / prompt-events.jsonl — live prompt produced message event
- cancel-live.json — cancel → Envelope status=cancelled

## Notes
- Pi 0.82.1 within compat_range >=0.80 <0.90
- Windows spawn uses cmd.exe /c (Node 24 EINVAL on direct .cmd)
- D2 fallback NOT triggered
