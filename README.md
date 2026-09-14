# 芯祥 FAE 型号速查静态网页版

这是从本地离线知识库导出的静态网页版。数据文件在 `data/products.json`，页面通过浏览器直接加载，不需要后端。

## 本地预览

```bash
python3 -m http.server 8000 --directory .
```

然后用浏览器打开 `http://127.0.0.1:8000/`。

## 发布到 GitHub Pages

1. 在 GitHub 创建一个仓库，仓库名例如 `fae-knowledge-web`。
2. 把这个目录中的文件上传到仓库，或者用 Git 推送。
3. 打开仓库 Settings → Pages。
4. Source 选择 `Deploy from a branch`，Branch 选择 `main`，目录选择 `/ (root)`。
5. 保存后等待几分钟，访问 `https://<用户名>.github.io/<仓库名>/`。

## 更新数据

本静态页不会自动扫描规格书。请在本地离线知识库中重新扫描并生成 `data/products.json` 后，再替换此文件并推送。
