# 中文标题：Markdown 预览

这是 **粗体**、*斜体*、~~删除线~~，以及行内代码 `npm run build`。

## 表格

| 名称 | 数值 |
| :--- | ---: |
| 中文 | 42 |
| second | 7 |

## 任务列表

- [x] 已完成
- [ ] 待办事项

## 代码

```js
const msg = '你好，世界';
const veryLongLine = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
console.log(msg, veryLongLine);
```

```python
def hello():
    return "世界"
```

> 引用块的 **内容**
>
> 第二行

---

[示例链接](https://example.com)

![本地图标](pic.png)

## 安全测试

<img src="x" onerror="window.__mdpXss = 1">

<script>window.__mdpXss = 2</script>

<iframe src="https://example.com"></iframe>

<a href="javascript:window.__mdpXss=3">bad link</a>

<div onclick="window.__mdpXss=4">clickable</div>
