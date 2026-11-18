"""
Sysbin Studio Code — Python 内核
为编辑器提供纯标准库实现的代码相关能力：
  - json_fmt : JSON 格式化 / 压缩 / 校验
  - convert  : JSON / YAML / XML 互转
  - stats    : 代码行数统计
  - py_check : Python 语法检查（编译期诊断）
调用约定：python kernel.py '<json>'  →  stdout 输出一行 JSON
"""
import sys, json, io, tokenize, ast
import xml.etree.ElementTree as ET
import xml.dom.minidom

try:
    import yaml
except ImportError:
    yaml = None


# ───────────── XML ⇄ JSON 结构互转 ─────────────

def xml_to_dict(el):
    """把 ElementTree 节点转成可 JSON 序列化的 dict。"""
    node = {}
    for k, v in el.attrib.items():
        node['@' + k] = v
    text = (el.text or '').strip()
    children = list(el)
    if children:
        for child in children:
            value = xml_to_dict(child)
            if child.tag in node:
                if isinstance(node[child.tag], list):
                    node[child.tag].append(value)
                else:
                    node[child.tag] = [node[child.tag], value]
            else:
                node[child.tag] = value
    elif text:
        if node:
            node['#text'] = text
        else:
            return text
    return node if node else ''


def dict_to_el(tag, value, parent=None):
    """把 dict 转成 ElementTree 节点。"""
    el = ET.Element(tag) if parent is None else ET.SubElement(parent, tag)
    if isinstance(value, dict):
        for k, v in value.items():
            if k.startswith('@'):
                el.set(k[1:], str(v))
            elif k == '#text':
                el.text = str(v)
            elif isinstance(v, list):
                for item in v:
                    dict_to_el(k, item, el)
            else:
                dict_to_el(k, v, el)
    else:
        el.text = '' if value is None else str(value)
    return el


# ───────────── 各动作实现 ─────────────

def act_json_fmt(data):
    raw = data.get('raw', '')
    if not raw.strip():
        return {"error": "内容为空"}
    obj = json.loads(raw)
    mode = data.get('mode', 'pretty')
    if mode == 'minify':
        return {"result": json.dumps(obj, separators=(',', ':'), ensure_ascii=False)}
    if mode == 'sort':
        def sort_keys(o):
            if isinstance(o, dict):
                return {k: sort_keys(o[k]) for k in sorted(o)}
            if isinstance(o, list):
                return [sort_keys(i) for i in o]
            return o
        return {"result": json.dumps(sort_keys(obj), indent=4, ensure_ascii=False)}
    return {"result": json.dumps(obj, indent=4, ensure_ascii=False)}


def act_convert(data):
    src = (data.get('src') or '').lower()
    dst = (data.get('dst') or '').lower()
    raw = data.get('raw', '')
    if src == dst:
        return {"error": "源格式与目标格式相同，无需转换"}
    if yaml is None and 'yaml' in (src + dst):
        return {"error": "当前 Python 未安装 PyYAML，无法进行 YAML 转换。请执行：pip install pyyaml"}

    if src == 'json':
        obj = json.loads(raw)
    elif src == 'yaml':
        obj = yaml.safe_load(raw)
    elif src == 'xml':
        obj = {ET.fromstring(raw).tag: xml_to_dict(ET.fromstring(raw))}
    else:
        return {"error": "不支持的源格式：" + src}

    if dst == 'json':
        return {"result": json.dumps(obj, indent=4, ensure_ascii=False)}
    if dst == 'yaml':
        return {"result": yaml.safe_dump(obj, allow_unicode=True, sort_keys=False, default_flow_style=False)}
    if dst == 'xml':
        if isinstance(obj, dict) and len(obj) == 1:
            root_tag, root_val = next(iter(obj.items()))
        else:
            root_tag, root_val = 'root', obj
        el = dict_to_el(str(root_tag), root_val)
        try:
            ET.indent(el, space="  ")
        except AttributeError:
            pass
        return {"result": '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(el, encoding='unicode')}
    return {"error": "不支持的目标格式：" + dst}


def act_xml_fmt(data):
    raw = data.get('raw', '')
    pretty = xml.dom.minidom.parseString(raw).toprettyxml(indent="  ")
    lines = [ln for ln in pretty.split('\n') if ln.strip()]
    if lines and lines[0].startswith('<?xml'):
        lines[0] = '<?xml version="1.0" encoding="UTF-8"?>'
    return {"result": '\n'.join(lines)}


def act_stats(data):
    text = data.get('raw', '')
    lines = text.split('\n')
    blank = sum(1 for l in lines if not l.strip())
    comment = 0
    in_block = False
    for l in lines:
        s = l.strip()
        if in_block:
            comment += 1
            if '*/' in s:
                in_block = False
            continue
        if s.startswith('/*'):
            comment += 1
            if '*/' not in s:
                in_block = True
        elif s.startswith('//') or s.startswith('#') or s.startswith('*') or s.startswith('--'):
            comment += 1
    total = len(lines)
    return {
        "result": {
            "lines": total,
            "code": max(0, total - blank - comment),
            "blank": blank,
            "comment": comment,
            "chars": len(text),
            "words": len(text.split())
        }
    }


def act_py_check(data):
    """用编译期检查给出语法诊断，返回 行/列/信息 列表。"""
    src = data.get('raw', '')
    name = data.get('name') or '<source>'
    try:
        compile(src, name, 'exec', ast.PyCF_ONLY_AST)
        return {"result": {"ok": True, "diagnostics": []}}
    except SyntaxError as e:
        line = e.lineno or 1
        col = (e.offset or 1) - 1
        text_line = ''
        src_lines = src.split('\n')
        if 0 < line <= len(src_lines):
            text_line = src_lines[line - 1]
        return {"result": {
            "ok": False,
            "diagnostics": [{
                "line": line,
                "column": col + 1,
                "endColumn": (e.end_offset or (e.offset or 1)),
                "message": e.msg or str(e),
                "text": text_line
            }]
        }}
    except Exception as e:
        return {"result": {"ok": False, "diagnostics": [{"line": 1, "column": 1, "message": str(e), "text": ""}]}}


ACTIONS = {
    'json_fmt': act_json_fmt,
    'json': act_json_fmt,
    'convert': act_convert,
    'xml_fmt': act_xml_fmt,
    'stats': act_stats,
    'py_check': act_py_check,
}


def handle(data):
    action = data.get('action')
    fn = ACTIONS.get(action)
    if fn is None:
        return {"error": "未知操作：" + str(action)}
    try:
        return fn(data)
    except Exception as e:
        msg = str(e)
        if isinstance(e, json.JSONDecodeError):
            msg = "JSON 语法错误（第 %d 行第 %d 列）：%s" % (e.lineno, e.colno, e.msg)
        return {"error": msg}


if __name__ == "__main__":
    if len(sys.argv) > 1:
        try:
            payload = json.loads(sys.argv[1])
        except Exception as e:
            print(json.dumps({"error": "参数解析失败：" + str(e)}, ensure_ascii=False))
            sys.exit(0)
        out = handle(payload)
        if 'result' in out and not isinstance(out['result'], str):
            out['result'] = out['result']
        print(json.dumps(out, ensure_ascii=False))
