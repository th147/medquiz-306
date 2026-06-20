# 一研为定 · 接管指南

> 把这份文件内容发给 AI 助手，它就能立刻接管这个网站的管理。

---

## 项目概况

- **项目名**：一研为定 · 西医综合智能刷题平台
- **域名**：https://medquiz-306.onrender.com（Render 部署）
- **代码仓库**：https://github.com/th147/medquiz-306
- **技术栈**：Node.js + Express + SQLite + 单页 HTML/CSS/JS
- **入口文件**：`server.js`
- **数据库**：`data.db`（SQLite）

## 管理员账号

- 用户名：`admin`
- 密码：`admin306`

## 项目结构

```
medquiz/
├── server.js          # 后端入口（所有API + 数据库初始化）
├── data.db            # SQLite 数据库（用户、题目、记录、评论）
├── package.json
├── .gitignore         # 忽略 node_modules、data.db、uploads
├── TAKEOVER.md        # 本文件
└── public/
    ├── index.html     # 前端主页面（单页应用）
    ├── viewer.html    # 笔记在线查看页面
    ├── js/            # PDF.js 等前端库（可能已删除）
    └── uploads/
        ├── notes/     # 上传的笔记文件
        ├── pdf_cache/ # PDF 预转换的 PNG 缓存
        └── avatars/   # 用户头像
```

## 核心功能

1. 用户系统：注册需激活码，登录JWT认证
2. 题库：选择题（A/B/C/D/X型），支持年份索引
3. 做题：随机/顺序刷题，记录答题历史
4. 真题试卷：按年份组卷，显示完成进度
5. 评论系统：每题可评论、点赞、收藏
6. 笔记上传：管理员上传PDF/Word/图片/文本
7. 笔记查看：PDF转PNG在线查看，支持翻页
8. 管理后台：用户管理、题库管理

## 重要约束（必须遵守）

### 绝对不能删除或修改的数据
- 用户账号、密码、注册信息
- 题库中的所有题目
- 用户的做题记录、评论、点赞
- `public/uploads/` 下的所有文件
- `data.db` 数据库文件

### 服务器操作规范
- 启动：`cd /workspace/medquiz && node server.js`
- 重启：`kill $(lsof -t -i:3000)` 后重新启动
- 不要执行 `rm -f data.db` 或删除数据库
- 不要删除 `public/uploads/` 下的任何文件
- 测试新功能时用临时文件，不要动实际数据

## 部署方式

Render 自动部署，连接 GitHub 仓库 main 分支。
推送代码后 Render 自动构建部署。

**重要：Render 免费版每次部署会清空数据，但系统已内置 GitHub 自动备份机制。**

## 数据持久化（自动备份）

系统每隔 5 分钟自动将数据库备份到 GitHub 仓库的 `backup/data.db`。
服务器启动时自动从 GitHub 下载最新备份。

- 备份文件：`backup/data.db`（GitHub 上的文件，不随部署清空）
- 备份频率：每 5 分钟
- 启动恢复：服务器启动时自动下载
- 优雅关闭：SIGTERM/SIGINT 时触发最后一次备份

**因此用户数据不会因部署而丢失。**

## 关键 API 端点

| 端点 | 说明 |
|------|------|
| POST /api/auth/register | 注册 |
| POST /api/auth/login | 登录 |
| GET /api/questions | 获取题库 |
| POST /api/questions | 添加题目（管理员） |
| POST /api/questions/import | 批量导入 |
| GET /api/records | 做题记录 |
| POST /api/records | 提交答案 |
| GET /api/notes | 笔记列表 |
| POST /api/notes | 上传笔记（管理员） |
| GET /api/notes/:id/view | 在线查看 |
| GET /api/notes/:id/download | 下载（管理员） |
| GET /api/notes/:id/pages/count | PDF页数 |
| GET /api/notes/:id/pages/:n | PDF第n页图片 |
| GET /api/admin/users | 用户列表（管理员） |
| DELETE /api/admin/questions | 清空题库（管理员） |

## 如果我需要你做什么

直接说需求即可，例如：
- "帮我添加一个新功能..."
- "网站有个bug..."
- "帮我优化..."
- "我要导入一批题目..."