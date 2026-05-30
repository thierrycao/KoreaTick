# 韩股快看中文站

一个手机优先的韩国股票行情中文页面，使用 Naver Stock 手机站接口作为数据源，并通过 Netlify Functions 做后端代理，避免浏览器跨域问题。

## 本地运行

```bash
node server.js
```

然后打开：

```text
http://127.0.0.1:4173
```

不要直接双击 `index.html`，因为 `file://` 页面无法调用本地行情代理。

## 部署到 Netlify

1. 打开 https://app.netlify.com/ 并创建新站点。
2. 选择本目录或把本目录上传/连接 Git 仓库。
3. Netlify 会读取 `netlify.toml`：
   - Publish directory: `.`
   - Functions directory: `netlify/functions`
4. 部署后前端会通过 `/api/quotes` 和 `/api/leaders` 调用 Netlify Functions。

## 支持的代码

- 韩国股票：输入 6 位代码，例如 `005930`、`000660`、`402340`
- 韩国指数：`KOSPI`、`KOSDAQ`、`KPI200`
- 标准写法：`KRX:005930`

## 数据说明

- 行情、指数和市值榜来自 Naver Stock 手机站接口。
- 页面不提供交易功能，不保存交易账号。
- Naver 接口字段或授权规则变化时，可能需要更新 `netlify/functions` 下的代理代码。

## 资金流与策略评分

新增 `/api/insights`：

```text
/api/insights?symbols=KRX:005930,KRX:000660
```

它会读取 Naver 个股综合信息中的外资、机构、个人交易趋势，并结合最近日线生成：

- 主力资金分
- 技术面分
- 风险分
- 总评分
- 突破买点、回踩参考、纪律止损、分批止盈

评分只用于观察和纪律提示，不构成投资建议。
