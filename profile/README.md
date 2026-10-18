# profile 配置样例

这两个文件来自这台 Mac 的 `~/.dsh/profiles/desktop/`，只作为参考。

| 文件 | 用途 |
| --- | --- |
| `cordis.patch.yml.example` | profile 的补丁层：默认模型、权限预设、皮肤外观、生图 provider、插件开关 |
| `compatibility.json.example` | 版本豁免：允许 `dsh-plugin-subscriptions@0.9.9` 在 `0.2.1-rc.2` 上运行 |

## 怎么用

- **不要整份覆盖**新机器的 `cordis.patch.yml`。只把需要的行合并进去，尤其是：
  - `agent-default-model` 的 provider / model / reasoningEffort
  - `permission` 的预设（样例里默认是 `danger-full-access`，按需改）
  - 皮肤、生图、各插件的 config
- `compatibility.json` 可以直接复制到：
  - Windows：`%USERPROFILE%\.dsh\profiles\desktop\compatibility.json`
  - macOS：`~/.dsh/profiles/desktop/compatibility.json`

里面没有路径和密钥，但 provider / OAuth 这类值和新机器的登录方式有关，合并后要在设置里重新选。
