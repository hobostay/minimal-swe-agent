# 给库存查询增加大小写不敏感选项

给 `inventory.cjs` 中的 `findBySku(rows, sku)` 增加可选的第三个参数 `{ ignoreCase: true }`。启用时对 ASCII SKU 忽略大小写，多个匹配返回原始列表里的第一项；不要改动输入记录或返回记录的原始 SKU。省略选项或传 `false` 时，继续精确匹配；找不到时仍返回 `null`。

在 `cli.cjs` 支持 `node cli.cjs <file> <sku> --ignore-case`，把选项传给 `findBySku`。保留无选项时的 JSON 输出和退出码（找到 `0`，没找到 `1`），未知选项仍以 `2` 退出。

仅可修改 `inventory.cjs` 和 `cli.cjs`。不要修改或新增测试、数据或其他文件。完成后运行 `node --test inventory.test.cjs`，并可运行 `node cli.cjs sample.json AB-1 --ignore-case` 检查新参数。最终说明兼容性和实际运行的检查。
