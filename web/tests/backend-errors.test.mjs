import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('backend error envelope provides stable code and public stage without service calls', () => {
  execFileSync(
    'python3',
    [
      '-c',
      `
import ast
from pathlib import Path
from types import SimpleNamespace
source=ast.parse(Path('app.py').read_text())
function=next(node for node in source.body if isinstance(node,ast.FunctionDef) and node.name=='error_response')
class Response:
 def __init__(self,status_code,content): self.status_code=status_code; self.content=content
scope={'Request':object,'JSONResponse':Response}
exec(compile(ast.Module(body=[function],type_ignores=[]),'app.py','exec'),scope)
for path,stage in [('/ask','answer'),('/ingest','upload'),('/ingest/example-job','upload'),('/session','session')]:
 request=SimpleNamespace(url=SimpleNamespace(path=path),state=SimpleNamespace(trace={}))
 response=scope['error_response'](request,503,'infrastructure_unavailable','detail')
 assert response.status_code==503
 assert response.content=={'code':'infrastructure_unavailable','error_code':'infrastructure_unavailable','stage':stage,'detail':'detail'}
 assert request.state.trace['error_code']=='infrastructure_unavailable'
`,
    ],
    { cwd: fileURLToPath(new URL('../../', import.meta.url)) },
  );
});
