# S1 spike — blocked（无 OPENAI_API_KEY）

日期：2026-07-28

## 状态

NeedsHuman / blocked：本机环境未设置 `OPENAI_API_KEY`，无法执行真实 Responses API background round-trip。按 owner 指示不伪造 live 证据；mock / e2e 路径继续推进。

## 编码基准（文档假设，待 live 确认）

- OpenAI 文档将 `url_citation.start_index` / `end_index` 描述为正文 character ranges。
- 实现按 **UTF-16 code units**（JavaScript `String` 索引 / `slice`）注入 `[^n]`。
- 含非 BMP 字符的样本需在有 key 后补跑 S1，确认或修正该假设。

## 恢复动作

```bash
# 设置 OPENAI_API_KEY 后：
# 1) 最小档 background + web_search（max_tool_calls<=5）
# 2) 落盘脱敏响应样本到 evidence/research-module/s1-spike/
# 3) 确认 annotations 形态与 index 编码
# 4) 再跑真实验收 run（max_tool_calls<=20）
```
