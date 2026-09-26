# 宝塔面板部署（智学问答）

本项目不是纯静态站：需要 Node 同时提供 `dist` + `/api/questions` + `/api/llm`。

## 1. 服务器准备

1. 宝塔安装 **Nginx**、**PM2 管理器**（或「Node 项目」）
2. 安装 **Node.js ≥ 18**（软件商店 → Node 版本管理器）
3. 把项目传到服务器，例如 `/www/wwwroot/aianswer`

## 2. 构建

SSH 或宝塔终端进入项目目录：

```bash
cd /www/wwwroot/aianswer
npm install
npm run build
```

确认存在目录：`dist/`，以及可写：`data/questions.json`。

## 3. 全站共用模型（`data/llm.json`）

可手写文件，也可在网页「添加模型」——**都会写入同一文件**：

```bash
cd /www/wwwroot/aianswer
cp data/llm.example.json data/llm.json
# 或直接在前端添加；改文件后 pm2 restart aianswer
```

格式：

```json
{
  "activeId": "local-qwen",
  "profiles": [
    {
      "id": "local-qwen",
      "name": "内网 Qwen (61.144.189.71:8066 Chat)",
      "baseUrl": "http://61.144.189.71:8066/v1",
      "model": "Qwen/Qwen2.5-3B-Instruct",
      "apiKey": "",
      "temperature": 0.1
    }
  ]
}
```

## 4. 用 PM2 启动（推荐）

```bash
cd /www/wwwroot/aianswer
PORT=5174 HOST=127.0.0.1 pm2 start server.mjs --name aianswer
pm2 save
```

或在宝塔 **PM2 管理器 → 添加项目**：

| 项 | 值 |
|----|-----|
| 项目路径 | `/www/wwwroot/aianswer` |
| 启动文件 | `server.mjs` |
| 运行目录 | 同上 |
| 项目名称 | `aianswer` |

环境变量（可选）：`PORT=5174`、`HOST=127.0.0.1`

本地自检：

```bash
curl -s http://127.0.0.1:5174/api/llm/config
# 应含 "configured":true，且响应里没有 apiKey
curl -s http://127.0.0.1:5174/api/questions | head
```

改完 `data/llm.json` 后执行 `pm2 restart aianswer`。演示结束：`pm2 stop aianswer`。

## 5. Nginx 反代（网站 → 设置）

新建站点（域名或 IP），**不要**只指到 `dist` 当纯静态。  
在「反向代理」或配置文件里：

```nginx
server {
    listen 80;
    server_name your.domain.com;

    location / {
        proxy_pass http://127.0.0.1:5174;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # LLM 流式输出
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
}
```

申请 SSL 后同样反代到 `127.0.0.1:5174`。

## 6. 权限与数据

```bash
chown -R www:www /www/wwwroot/aianswer/data
chmod -R u+rw /www/wwwroot/aianswer/data
```

题库保存在服务器上的 `data/questions.json`；模型在 `data/llm.json`（前端添加也会写这里）。

## 7. 上线检查

- 打开域名 → 题库 / 答题能进  
- 导入或保存题目成功  
- 答题页选「站点共用」能出解析（Key 在服务器 `data/llm.json`）  
- 面试演示前关闭「调试」

## 8. 更新版本

```bash
cd /www/wwwroot/aianswer
git pull   # 若用 git
npm install
npm run build
pm2 restart aianswer
```

## 常见问题

| 现象 | 原因 |
|------|------|
| 页面 503「未找到 dist」 | 没执行 `npm run build` |
| 题库保存失败 | `data/` 不可写或部署在只读目录 |
| 能打开页但不能对话 | Nginx 没反代到 Node，或只配了静态 `dist` |
| 每人还要自己加模型 | 服务器缺少 `data/llm.json`，或未写 apiKey/baseUrl/model |
| 流式一字不出 / 很久才出 | 打开 `proxy_buffering off` |
