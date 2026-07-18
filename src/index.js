const { Command } = require('commander');
const fs = require('fs');
const program = new Command();

const client = require('./adt-client');
const cfg = require('./config');

function jsonOrText(text, jsonObj, jsonFlag) {
  if (jsonFlag) {
    console.log(JSON.stringify(jsonObj, null, 2));
  } else {
    console.log(text);
  }
}

function run() {
  program
    .name('gxx-abap')
    .description('ABAP ADT 命令行工具 - 从终端操作 SAP ABAP 开发系统')
    .version('1.0.0');

  // ── 连接配置 ──
  program
    .command('config')
    .description('配置系统连接信息（持久化到 ~/.gxx-abap/config.json）')
    .option('--host <host>', 'SAP 系统主机名或IP')
    .option('--port <port>', '端口号')
    .option('-u, --user <user>', '用户名')
    .option('-p, --password <password>', '密码')
    .option('-c, --client <client>', 'Client')
    .option('--http', '使用HTTP而不是HTTPS')
    .option('--show', '查看当前配置（密码不显示）')
    .option('--json', 'JSON格式输出')
    .action((opts) => {
      if (opts.show) {
        const info = cfg.showConnection();
        if (!info) {
          jsonOrText('未配置', { configured: false }, opts.json);
          return;
        }
        const display = {
          ...info,
          password: info.hasPassword ? '******' : '(未设置)',
        };
        delete display.hasPassword;
        jsonOrText(
          `当前配置\n  系统: ${display.host}\n  端口: ${display.port}\n  用户: ${display.user}\n  Client: ${display.client}\n  密码: ${display.password}`,
          { configured: true, ...display },
          opts.json
        );
        return;
      }

      if (!opts.host && !opts.user && !opts.password) {
        console.error('错误: 至少需要 --host、-u、-p 中的一项');
        process.exit(1);
      }

      const c = cfg.setConnection({
        host: opts.host,
        port: opts.port,
        user: opts.user,
        password: opts.password,
        client: opts.client,
        protocol: opts.http ? 'http' : undefined,
      });

      jsonOrText(
        `配置已保存到 ~/.gxx-abap/config.json\n  系统: ${c.host}\n  端口: ${c.port || '44300'}\n  用户: ${c.user}\n  Client: ${c.client || '100'}\n  ${c.protocol === 'http' ? 'HTTP' : 'HTTPS'}`,
        { saved: true, host: c.host, port: c.port || '44300', user: c.user, client: c.client || '100' },
        opts.json
      );
    });

  // ── 测试连接 ──
  program
    .command('ping')
    .description('测试与SAP系统的连接')
    .option('--json', 'JSON格式输出')
    .action(async (opts) => {
      try {
        const info = await client.testConnection();
        jsonOrText(
          `连接成功\n  系统: ${info.sid || '未知'}\n  SAP_BASIS: ${info.basisVersion || '未知'}\n  服务器: ${info.host}\n  用户: ${info.user}`,
          { status: 'connected', ...info },
          opts.json
        );
      } catch (e) {
        jsonOrText(`连接失败: ${e.message}`, { status: 'error', message: e.message }, opts.json);
        process.exit(1);
      }
    });

  // ── 连接状态 ──
  program
    .command('status')
    .description('查看当前连接状态')
    .option('--json', 'JSON格式输出')
    .action(async (opts) => {
      try {
        const info = await client.testConnection();
        jsonOrText(
          `已连接\n  系统: ${info.host}\n  SID: ${info.sid || '未知'}\n  SAP_BASIS: ${info.basisVersion || '未知'}\n  用户: ${info.user}\n  Client: ${cfg.showConnection()?.client || '未知'}`,
          { status: 'connected', ...info },
          opts.json
        );
      } catch (e) {
        jsonOrText('未配置或无法连接', { status: 'disconnected', message: e.message }, opts.json);
      }
    });

  // ── 清除配置 ──
  program
    .command('clear')
    .description('清除所有配置信息')
    .action(() => {
      cfg.clear();
      client.reset();
      console.log('配置已清除');
    });

  // ── 对象列表 ──
  program
    .command('ls')
    .description('搜索ABAP对象')
    .argument('<pattern>', '对象名称（支持*通配符）')
    .option('--json', 'JSON格式输出')
    .action(async (pattern, opts) => {
      try {
        const query = pattern || '*';
        const res = await client.request('GET',
          `/sap/bc/adt/repository/informationsystem/executableObjects?query=${encodeURIComponent(query)}&maxResults=50`
        );

        // 解析 XML
        const objRegex = /<adtcore:objectReference[^>]*adtcore:type="([^"]+)"[^>]*adtcore:name="([^"]+)"[^>]*\/>/g;
        const objRegex2 = /<adtcore:objectReference[^>]*adtcore:name="([^"]+)"[^>]*adtcore:type="([^"]+)"[^>]*\/>/g;
        const items = [];
        let m;
        while ((m = objRegex.exec(res.body)) !== null) {
          items.push({ name: m[2], type: m[1] });
        }
        while ((m = objRegex2.exec(res.body)) !== null) {
          if (!items.find(i => i.name === m[1])) items.push({ name: m[1], type: m[2] });
        }

        if (opts.json) {
          console.log(JSON.stringify({ search: query, count: items.length, objects: items }, null, 2));
          return;
        }
        const typeMap = {
          'PROG/P': '程序', 'CLAS/OC': '类', 'INTF/OI': '接口',
          'TABL/DT': '表', 'TABL/DS': '结构', 'FUGR/F': '函数组',
          'DDLS/DF': 'CDS视图', 'FUGR/I': '函数组Include', 'TRAN/T': '事务码',
          'FUGR/FF': '函数模块',
        };
        for (const item of items) {
          item.typeLabel = typeMap[item.type] || item.type;
        }

        if (items.length === 0) {
          console.log(`未找到匹配"${query}"的对象`);
        } else {
          console.log(`找到 ${items.length} 个对象 (${query})
`);
          for (const item of items) {
            console.log(`  ${item.name.padEnd(35)} ${item.typeLabel}`);
          }
        }
      } catch (e) {
        console.error('搜索失败:', e.message);
        process.exit(1);
      }
    });

  program
    .command('cat')
    .description('查看对象源码')
    .argument('<path>', '对象名（自动识别类/程序/接口，表需指定 -t table）')
    .option('-t, --type <type>', '对象类型: class, program, interface, function')
    .option('--json', 'JSON格式输出')
    .action(async (objPath, opts) => {
      try {
        const type = opts.type || guessType(objPath);
        const adtPath = resolveAdtPath(objPath, type);
        const res = await client.request('GET', adtPath);
        if (res.status !== 200) {
          const errMsg = res.body.match(/<message[^>]*>([^<]+)/);
          throw new Error(errMsg ? errMsg[1] : `HTTP ${res.status}`);
        }
        jsonOrText(res.body, { path: objPath, type, source: res.body }, opts.json);
      } catch (e) {
        console.error(`读取失败 (${objPath}): ${e.message}`);
        process.exit(1);
      }
    });

  program
    .command('create')
    .description('创建ABAP对象')
    .argument('<name>', '对象名称')
    .requiredOption('-t, --type <type>', '对象类型 (class, program, interface, function)')
    .option('--description <desc>', '对象描述')
    .option('--package <pkg>', '开发类/包名（默认 $TMP）')
    .option('--transport <tr>', '传输请求号（不指定则 SAP 自动创建）')
    .option('--json', 'JSON格式输出')
    .action(async (name, opts) => {
      try {
        await client.autoConnect();
        const upperName = name.toUpperCase();
        const desc = opts.description || '';
        let adtPath, body, contentType = 'application/xml';

        switch (opts.type) {
          case 'program':
            contentType = 'application/vnd.sap.adt.programs.programs.v2+xml';
            break;
          case 'class':
            contentType = 'application/vnd.sap.adt.oo.classes.v2+xml';
            break;
          case 'interface':
            contentType = 'application/vnd.sap.adt.oo.interfaces.v4+xml';
            break;
          case 'table':
            contentType = 'application/vnd.sap.adt.tables.v2+xml';
            break;
          case 'function':
            contentType = 'application/vnd.sap.adt.functions.groups.v2+xml';
            break;
        }

        switch (opts.type) {
          case 'program': {
            adtPath = '/sap/bc/adt/programs/programs';
            body = `<?xml version="1.0" encoding="UTF-8"?>
<program:abapProgram
  xmlns:program="http://www.sap.com/adt/programs/programs"
  xmlns:adtcore="http://www.sap.com/adt/core"
  program:programType="executableProgram"
  adtcore:name="${upperName}"
  adtcore:description="${desc}"
  adtcore:responsible="${cfg.showConnection()?.user || 'DEVUSER'}"
  adtcore:masterLanguage="ZH">
  <adtcore:packageRef adtcore:name="${opts.package || '$TMP'}"/>
  ${opts.transport ? `<adtcore:transportRequest adtcore:number="${opts.transport.toUpperCase()}"/>` : ''}

</program:abapProgram>`;
            break;
          }
          case 'class': {
            adtPath = '/sap/bc/adt/oo/classes';
            body = `<?xml version="1.0" encoding="UTF-8"?>
<class:abapClass
  xmlns:class="http://www.sap.com/adt/oo/classes"
  xmlns:adtcore="http://www.sap.com/adt/core"
  class:final="false" class:abstract="false" class:visibility="public"
  class:category="generalObjectType"
  adtcore:name="${upperName}"
  adtcore:description="${desc}"
  adtcore:responsible="${cfg.showConnection()?.user || 'DEVUSER'}"
  adtcore:masterLanguage="ZH">
  <adtcore:packageRef adtcore:name="${opts.package || '$TMP'}"/>
</class:abapClass>`;
            break;
          }
          case 'interface': {
            adtPath = '/sap/bc/adt/oo/interfaces';
            body = `<?xml version="1.0" encoding="UTF-8"?>
<interface:abapInterface
  xmlns:interface="http://www.sap.com/adt/oo/interfaces"
  xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="${upperName}"
  adtcore:description="${desc}"
  adtcore:responsible="${cfg.showConnection()?.user || 'DEVUSER'}"
  adtcore:masterLanguage="ZH">
  <adtcore:packageRef adtcore:name="${opts.package || '$TMP'}"/>
</interface:abapInterface>`;
            break;
          }

          case 'function': {
            adtPath = '/sap/bc/adt/functions/groups';
            body = `<?xml version="1.0" encoding="UTF-8"?>
<group:abapFunctionGroup
  xmlns:group="http://www.sap.com/adt/functions/groups"
  xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="${upperName}"
  adtcore:description="${desc}"
  adtcore:responsible="${cfg.showConnection()?.user || 'DEVUSER'}"
  adtcore:masterLanguage="ZH">
  <adtcore:packageRef adtcore:name="${opts.package || '$TMP'}"/>
</group:abapFunctionGroup>`;
            break;
          }

          default:
            throw new Error(`不支持的对象类型: ${opts.type}，支持: class, program, interface, function`);
        }

        const url = adtPath + (opts.transport ? `?corrNr=${opts.transport.toUpperCase()}` : '');
        await client.autoConnect();
        const res = await client.rawRequest('POST', url, {
          body,
          headers: { 'Content-Type': contentType, 'X-CSRF-Token': client.csrfToken, 'Cookie': client.cookie },
        });

        if (res.status === 200 || res.status === 201) {
          const trMsg = opts.transport ? `请求号：${opts.transport.toUpperCase()}` : (opts.package && opts.package !== '$TMP' ? '(自动创建，请到 SE10 查看请求号)' : '');
          jsonOrText(
            `创建成功\n  对象: ${upperName}\n  类型: ${opts.type}${trMsg ? '\n  ' + trMsg : ''}`,
            { success: true, name: upperName, type: opts.type, transport: opts.transport || null },
            opts.json
          );
        } else {
          throw new Error(extractErrMsg(res.body) || `HTTP ${res.status}`);
        }
      } catch (e) {
        console.error(`创建失败: ${e.message}`);
        process.exit(1);
      }
    });

  program
    .command('put')
    .description('写入源码（锁定→写入→解锁）')
    .argument('<path>', '对象名')
    .argument('[file]', '源码文件路径（不传则从stdin读取）')
    .option('-t, --type <type>', '对象类型: class, program, interface, function')
    .option('--force-unlock', '写入前先强制解锁（用于解除残留锁）')
    .option('--json', 'JSON格式输出')
    .action(async (objPath, file, opts) => {
      let lockHandle = null;
      let objBase = null;
      let sessHeaders = null;

      try {
        const _type = opts.type || guessType(objPath);
        if (_type === 'table' || _type === 'cds') {
          throw new Error('此系统不支持通过 REST API 写入 ' + _type + ' 源码');
        }
        let source;
        if (file) {
          source = fs.readFileSync(file, 'utf8');
        } else {
          if (process.stdin.isTTY) throw new Error('请通过管道传入源码或指定文件路径');
          source = await new Promise((resolve, reject) => {
            const chunks = [];
            process.stdin.on('data', c => chunks.push(c));
            process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            process.stdin.on('error', reject);
          });
        }
        if (!source.trim()) throw new Error('源码为空');

        const type = opts.type || guessType(objPath);
        const name = objPath.replace(/^.*[/\\\\]/, '').toLowerCase();
        objBase = resolveAdtBase(name, type);
        const sourceUri = `${objBase}/source/main`;

        await client.autoConnect();
        const crypto = require('crypto');
        const connId = crypto.randomUUID();
        sessHeaders = {
          'sap-adt-connection-id': connId,
          'x-sap-adt-sessiontype': 'stateful',
          'Cookie': client.cookie,
          'X-CSRF-Token': client.csrfToken,
        };

        if (opts.forceUnlock) {
          const fur = await client.rawRequest('POST', `${objBase}?_action=UNLOCK&lockHandle=0`, {
            body: '',
            headers: { 'Content-Type': 'application/atom+xml; type=entry', ...sessHeaders },
          });
          if (fur.status === 200) {
            sessHeaders['sap-adt-connection-id'] = require('crypto').randomUUID();
          }
        }

{
          let r = await client.rawRequest('POST', `${objBase}?_action=LOCK&accessMode=MODIFY`, {
            body: '',
            headers: { 'Content-Type': 'application/atom+xml; type=entry', ...sessHeaders },
          });
          if (r.status !== 200) throw new Error(`锁定失败: ${extractErrMsg(r.body)}`);
          lockHandle = r.body.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/i)?.[1];
          if (!lockHandle) throw new Error('获取 lockHandle 失败');
        }
        const corrNr = '';

        try {
          const putParams = `lockHandle=${encodeURIComponent(lockHandle)}` + (corrNr ? `&corrNr=${encodeURIComponent(corrNr)}` : '');
          r = await client.request('PUT', `${sourceUri}?${putParams}`, {
            body: source,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', ...sessHeaders },
          });
          if (r.status !== 200) throw new Error(`写入失败: ${extractErrMsg(r.body)}`);
        } finally {
        }

        jsonOrText(
          `写入成功\n  对象: ${objPath}\n  类型: ${type}`,
          { success: true, path: objPath, type },
          opts.json
        );
      } catch (e) {
        console.error(`写入失败: ${e.message}`);
      } finally {
        // 调用解锁接口（API 网关）
        try {
          const cfg = require('./config');
          const conn = cfg.getConnection();
          if (conn) {
            const http = require(conn.protocol === 'http' ? 'http' : 'https');
            const auth = Buffer.from(`${conn.user}:${conn.password}`).toString('base64');
            const postData = JSON.stringify({ GRAG: objPath.toUpperCase().replace(/^.*[/\\]/, '') });
            const options = {
              hostname: conn.host,
              port: conn.port || '44300',
              path: `/sap/bc/zsx_intf_serv/zsx_oa?sap-client=${conn.client || '100'}&INTFID=AI_PUT_UNLOCK`,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${auth}`,
                'Content-Length': Buffer.byteLength(postData),
              },
              rejectUnauthorized: false,
              timeout: 10000,
            };
            await new Promise((resolve, reject) => {
              const req = http.request(options, (res) => { res.resume(); res.on('end', resolve); });
              req.on('error', (e) => { resolve(); });
              req.write(postData);
              req.end();
            });
          }
        } catch (e) { /* 忽略 */ }
        client.destroy();
      }
    });

  program
    .command('activate')
    .description('激活对象')
    .argument('<path>', '对象名（程序/类/接口/表）')
    .option('-t, --type <type>', '对象类型: class, program, interface, function')
    .option('--json', 'JSON格式输出')
    .action(async (objPath, opts) => {
      try {
        const type = opts.type || guessType(objPath);
        const name = objPath.replace(/^.*[/\\\\]/, '').toLowerCase();
        const sourceUri = resolveAdtPath(name, type);
        const adtType = resolveAdtType(type);
        
        const xml = `<?xml version="1.0" encoding="UTF-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="${sourceUri}" adtcore:type="${adtType}" adtcore:name="${name.toUpperCase()}"/></adtcore:objectReferences>`;
        
        const res = await client.request('POST', '/sap/bc/adt/activation?method=activate', {
          body: xml,
          headers: { 'Content-Type': 'application/xml' },
        });
        
        if (res.status !== 200) {
          throw new Error(res.body.match(/<message[^>]*>([^<]+)/)?.[1] || `HTTP ${res.status}`);
        }
        
        const checkOk = res.body.includes('checkExecuted="true"');
        const actOk = res.body.includes('activationExecuted="true"');
        const genOk = res.body.includes('generationExecuted="true"');
        
        const errors = [];
        const msgRegex = /<msg[^>]*>([\s\S]*?)<\/msg>/g;
        let msgMatch;
        while ((msgMatch = msgRegex.exec(res.body)) !== null) {
          const fullTag = msgMatch[0];
          const msgContent = msgMatch[1];
          const type = fullTag.match(/type="([^"]+)"/)?.[1] || '';
          const line = fullTag.match(/line="([^"]+)"/)?.[1];
          const stMatch = msgContent.match(/<shortText>([\s\S]*?)<\/shortText>/);
          const text = stMatch ? stMatch[1].replace(/<[^>]+>/g, '').trim() : '';
          if (text) errors.push({ type, line, text });
        }
        
        const parts = [];
        let hasError = false;
        if (errors.length > 0) {
          for (const e of errors) {
            const icon = e.type === 'E' ? '❌' : e.type === 'W' ? '⚠' : 'ℹ';
            parts.push(`${icon} L${e.line||'?'}: ${e.text}`);
            if (e.type === 'E') hasError = true;
          }
        }
        if (hasError) parts.unshift('❌ 语法检查未通过');
        else if (checkOk) parts.unshift('✅ 语法检查通过');
        if (actOk) parts.unshift('✅ 激活成功');
        if (genOk) parts.push('✅ 生成成功');
        if (!actOk && !hasError && !errors.length) parts.unshift('ℹ 无需激活（已为最新）');
        
        const text = `激活完成\n  对象: ${objPath}\n  类型: ${type}\n  ${parts.join('\n  ')}`;
        const jsonObj = {
          success: !hasError,
          path: objPath,
          type,
          checkExecuted: checkOk,
          activationExecuted: actOk,
          generationExecuted: genOk,
          errors: errors.length > 0 ? errors : undefined,
        };
        
        jsonOrText(text, jsonObj, opts.json);
        if (hasError) process.exit(1);
      } catch (e) {
        console.error(`激活失败: ${e.message}`);
        process.exit(1);
      }
    });

  // ── 传输管理 ──
  program
    .command('transport')
    .description('传输管理')
    .argument('<action>', '操作: list, object')
    .argument('[args...]', '参数')
    .option('--json', 'JSON格式输出')
    .action(async (action, args, opts) => {
      if (!action) {
        console.error('请指定操作: list, object');
        process.exit(1);
      }

      try {
        switch (action) {
          case 'list': {
            const res = await client.request('GET', '/sap/bc/adt/cts/transportrequests');

            if (opts.json) {
              console.log(JSON.stringify({ transports: res.body }, null, 2));
              return;
            }

            // 解析 XML 输出可读列表
            const regex = /<tm:request[^>]*tm:number="([^"]+)"[^>]*tm:owner="([^"]+)"[^>]*tm:desc="([^"]*)"[^>]*tm:status="([^"]+)"[^>]*tm:target="([^"]*)"[^>]*>/g;
            const items = [];
            let m;
            while ((m = regex.exec(res.body)) !== null) {
              const statusMap = { 'D': '可修改', 'R': '已发布' };
              items.push({ number: m[1], owner: m[2], desc: m[3], status: statusMap[m[4]] || m[4], target: m[5] || '-' });
            }

            const statusCounts = {};
            for (const item of items) {
              statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
            }

            console.log(`传输请求列表 (共 ${items.length} 个)\n`);
            for (const item of items) {
              console.log(`  ${item.number.padEnd(12)} ${item.status.padEnd(6)} ${item.owner.padEnd(8)} ${item.desc}`);
            }
            console.log(`\n状态: ${Object.entries(statusCounts).map(([k,v]) => k + '=' + v).join(', ')}`);
            break;
          }
          case 'object': {
            const objPath = args[0];
            if (!objPath) {
              console.error('用法: gxx-abap transport object <对象名>');
              process.exit(1);
            }
            const objType = guessType(objPath);
            const name = objPath.replace(/^.*[/\\]/, '').toLowerCase();
            const base = resolveAdtBase(name, objType);
            const uri = encodeURIComponent(base);
            
            const res = await client.request('GET', `/sap/bc/adt/repository/informationsystem/objectproperties/transports?uri=${uri}`);
            
            const trNum = res.body.match(/tpr:transport\s+number="([^"]+)"/)?.[1];
            const trDesc = res.body.match(/description="([^"]+)"/)?.[1];
            const trOwner = res.body.match(/owner="([^"]+)"/)?.[1];
            const trStatus = res.body.match(/status="([^"]+)"/)?.[1];
            
            if (trNum) {
              jsonOrText(
                `对象: ${objPath}\n  请求号: ${trNum}\n  描述: ${trDesc || ''}\n  负责人: ${trOwner || ''}\n  状态: ${trStatus === 'D' ? '可修改' : trStatus}`,
                { object: objPath, transportNumber: trNum, description: trDesc, owner: trOwner, status: trStatus },
                opts.json
              );
            } else {
              jsonOrText(`对象 ${objPath} 未关联传输请求`, { object: objPath, transportNumber: null }, opts.json);
            }
            break;
          }
          default:
            console.error(`未知传输操作: ${action}，支持: list, object`);
            process.exit(1);
        }
      } catch (e) {
        console.error(`传输操作失败: ${e.message}`);
        process.exit(1);
      }
    });

    

  // ── 代码检查 ──
  program
    .command('check')
    .description('语法检查')
    .argument('<path>', '对象路径')
    .option('-t, --type <type>', '对象类型: class, program, table, interface, function')
    .option('--json', 'JSON格式输出')
    .action(async (path, opts) => {
      try {
        if (!path) {
          console.error('请指定对象路径');
          process.exit(1);
        }
        const objType = opts.type || guessType(path);
        const name = path.replace(/^.*[/\\]/, '').toLowerCase();
        const sourceUri = resolveAdtPath(name, objType);
        const adtType = resolveAdtType(objType);

        const body = `<?xml version="1.0" encoding="UTF-8"?>
<checkrun:checkRun xmlns:checkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReferences>
    <adtcore:objectReference adtcore:uri="${sourceUri}" adtcore:type="${adtType}" adtcore:name="${name.toUpperCase()}"/>
  </adtcore:objectReferences>
</checkrun:checkRun>`;

        const res = await client.request('POST', '/sap/bc/adt/checkruns', {
          body,
          headers: { 'Content-Type': 'application/xml' },
        });

        const findings = [];
        const fRegex = /<finding[^>]*>([\s\S]*?)<\/finding>/g;
        let fMatch;
        while ((fMatch = fRegex.exec(res.body)) !== null) {
          const f = fMatch[1];
          const sev = f.match(/severity="([^"]+)"/)?.[1] || '';
          const line = f.match(/line="([^"]+)"/)?.[1];
          const msgMatch = f.match(/<message[^>]*>([^<]+)/);
          const msg = msgMatch ? msgMatch[1] : '';
          if (msg) findings.push({ severity: sev, line, message: msg });
        }

        const errors = findings.filter(f => f.severity === 'ERROR' || f.severity === 'error');
        const warnings = findings.filter(f => f.severity === 'WARNING' || f.severity === 'warning');

        if (opts.json) {
          console.log(JSON.stringify({ type: 'syntax', path, findings, errors: errors.length, warnings: warnings.length }, null, 2));
        } else {
          if (findings.length === 0) {
            console.log('✅ 语法检查通过，无错误');
          } else {
            console.log(`语法检查完成：${errors.length} 错误，${warnings.length} 警告\n`);
            for (const f of findings) {
              const icon = f.severity === 'ERROR' || f.severity === 'error' ? '❌' : '⚠';
              console.log(`  ${icon} L${f.line || '?'}: ${f.message}`);
            }
          }
        }
        if (errors.length > 0) process.exit(1);
      } catch (e) {
        console.error(`语法检查失败: ${e.message}`);
        process.exit(1);
      }
    });
  ;

    // ── 表结构 ──
  program
    .command('meta')
    .description('查看表/结构/数据元素')
    .argument('<name>', '表名/结构名/数据元素名')
    .option('--json', 'JSON格式输出')
    .action(async (name, opts) => {

      // 从 DDL 源码中提取字段名和数据元素
      function extractFields(ddlSource) {
        const fields = [];
        const lines = ddlSource.split('\n');
        for (const line of lines) {
          // 匹配: key fieldname : dataelement not null;
          let m = line.match(/^\s*key\s+(\w+)\s*:\s*(\w+)/);
          if (!m) {
            // 匹配: fieldname : dataelement;
            m = line.match(/^\s+(\w+)\s*:\s*(\w+)/);
          }
          if (m) {
            const dataElement = m[2].toLowerCase();
            if (dataElement !== '...' && !dataElement.startsWith('include')) {
              fields.push({ field: m[1], dataElement });
            }
          }
        }
        return fields;
      }

      // 从 DDL 源码中提取 include 的结构名
      function extractIncludes(ddlSource) {
        const includes = [];
        const re = /^\s*include\s+(\w+)/gm;
        let m;
        while ((m = re.exec(ddlSource)) !== null) {
          includes.push(m[1]);
        }
        return [...new Set(includes)];
      }

      // 获取数据元素的类型信息
      async function fetchElementInfo(elemNames) {
        const uniq = [...new Set(elemNames)];
        const results = await Promise.all(uniq.map(async (elem) => {
          try {
            const r = await client.request('GET', `/sap/bc/adt/ddic/dataelements/${elem}`);
            if (r.status !== 200) return null;
            const body = r.body;
            const getAttr = (attr) => { const x = body.match(new RegExp(`${attr}\\s*=\\s*"([^"]+)"`)); return x ? x[1] : ''; };
            const dtel = body.match(/<dtel:dataElement[^>]*>([\s\S]*?)<\/dtel:dataElement>/);
            let dataType = '', length = '', decimals = '';
            if (dtel) {
              const d = dtel[1];
              const gt = (tag) => { const x = d.match(new RegExp(`<${tag}>([^<]+)`)); return x ? x[1].trim() : ''; };
              dataType = gt('dtel:dataType');
              length = gt('dtel:dataTypeLength');
              decimals = gt('dtel:dataTypeDecimals');
            }
            const desc = getAttr('adtcore:description');
            return { name: elem, dataType, length, decimals, desc };
          } catch(e) { return null; }
        }));
        const map = {};
        results.filter(Boolean).forEach(r => map[r.name] = r);
        return map;
      }

      if (!name) { console.error('请指定表名'); process.exit(1); return; }
      try {
        const lowerName = name.toLowerCase();
        let ddlBody = null;
        let isDataElement = false;
        let dtelMeta = null;

        // 1. 依次尝试：表 → 结构 → 数据元素
        let ddlRes = await client.request('GET', `/sap/bc/adt/ddic/tables/${lowerName}/source/main`);
        if (ddlRes.status !== 200) {
          ddlRes = await client.request('GET', `/sap/bc/adt/ddic/structures/${lowerName}/source/main`);
        }
        if (ddlRes.status !== 200) {
          ddlRes = await client.request('GET', `/sap/bc/adt/functions/groups/${lowerName}/source/main`);
        }
        if (ddlRes.status === 200) {
          ddlBody = ddlRes.body;
        } else {
          // 尝试数据元素
          const dtelRes = await client.request('GET', `/sap/bc/adt/ddic/dataelements/${lowerName}`);
          if (dtelRes.status === 200) {
            isDataElement = true;
            dtelMeta = dtelRes.body;
          } else {
            throw new Error(ddlRes.body.match(/<message[^>]*>([^<]+)/)?.[1] || '未找到对象');
          }
        }

        // 数据元素：单独处理
        if (isDataElement) {
          const getAttr = (attr) => { const x = dtelMeta.match(new RegExp(`${attr}\\s*=\\s*"([^"]+)"`)); return x ? x[1] : ''; };
          const gt = (tag) => { const x = dtelMeta.match(new RegExp(`<dtel:${tag}>([^<]*)`)); return x ? x[1].trim() : ''; };
          const info = {
            name: getAttr('adtcore:name'),
            description: getAttr('adtcore:description'),
            typeKind: gt('typeKind'),
            typeName: gt('typeName'),
            dataType: gt('dataType'),
            length: gt('dataTypeLength'),
            decimals: gt('dataTypeDecimals'),
            shortLabel: gt('shortFieldLabel'),
            mediumLabel: gt('mediumFieldLabel'),
            longLabel: gt('longFieldLabel'),
            headingLabel: gt('headingFieldLabel'),
          };
          if (opts.json) {
            console.log(JSON.stringify(info, null, 2));
          } else {
            console.log(`\n数据元素: ${info.name}`);
            console.log(`  描述:       ${info.description || '(无)'}`);
            console.log(`  类型:       ${info.dataType || '(无)'}`);
            if (info.typeKind !== 'domain') console.log(`  类型类别:   ${info.typeKind || '(无)'}`);
            console.log(`  域:         ${info.typeName || '(无)'}`);
            if (info.length && info.length !== '000000') console.log(`  长度:       ${parseInt(info.length)}`);
            if (info.decimals && info.decimals !== '000000') console.log(`  小数:       ${parseInt(info.decimals)}`);
            if (info.shortLabel) console.log(`  标签:       ${info.shortLabel}`);
          }
          return;
        }

        // 表/结构：解析字段

        // 2. 提取直接字段
        let allFields = extractFields(ddlBody);

        // 3. 处理 include（递归获取 include 结构的字段）
        const includes = extractIncludes(ddlBody);
        for (const inc of includes) {
          try {
            // .include 对应的是结构，用 structures 端点
            const incRes = await client.request('GET', `/sap/bc/adt/ddic/structures/${inc.toLowerCase()}/source/main`);
            if (incRes.status === 200) {
              const incFields = extractFields(incRes.body);
              // 递归处理嵌套 include
              const nestedIncludes = extractIncludes(incRes.body);
              for (const nested of nestedIncludes) {
                try {
                  const nestedRes = await client.request('GET', `/sap/bc/adt/ddic/structures/${nested.toLowerCase()}/source/main`);
                  if (nestedRes.status === 200) {
                    allFields.push(...extractFields(nestedRes.body));
                  }
                } catch(e) { /* ignore */ }
              }
              allFields.push(...incFields);
            }
          } catch(e) { /* include 获取失败，忽略 */ }
        }

        // 4. 扩展字段（extend fieldname : 出现在 DDL 中，数据元素在下一行）
        const extendRe = /^\s+extend\s+(\w+)\s*:/gm;
        let em;
        while ((em = extendRe.exec(ddlBody)) !== null) {
          const existing = allFields.find(f => f.field.toLowerCase() === em[1].toLowerCase());
          if (!existing) {
            // 数据元素名同字段名（SAP 默认规则）
            allFields.push({ field: em[1], dataElement: em[1].toLowerCase() });
          }
        }

        // 去重（按 field 名）
        const seen = new Set();
        allFields = allFields.filter(f => {
          const key = f.field.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // 5. 批量获取数据元素类型
        const elemNames = allFields.map(f => f.dataElement);
        const elemMap = await fetchElementInfo(elemNames);

        const fullFields = allFields.map(f => {
          const info = elemMap[f.dataElement] || {};
          return {
            field: f.field.toUpperCase(),
            dataElement: f.dataElement.toUpperCase(),
            type: info.dataType || '',
            length: parseInt(info.length || '0'),
            decimals: parseInt(info.decimals || '0'),
            description: info.desc || '',
          };
        });

        if (opts.json) {
          console.log(JSON.stringify({ table: name.toUpperCase(), fields: fullFields }, null, 2));
        } else {
          console.log(`\n表: ${name.toUpperCase()} (${fullFields.length} 字段)\n`);
          console.log('字段名'.padEnd(18), '数据元素'.padEnd(18), '类型'.padEnd(8), '长度'.padEnd(6), '小数'.padEnd(4), '描述');
          console.log('-'.repeat(80));
          for (const f of fullFields) {
            console.log(f.field.padEnd(18), f.dataElement.padEnd(18), f.type.padEnd(8), (f.length || '').toString().padEnd(6), (f.decimals || '').toString().padEnd(4), f.description);
          }
        }
      } catch (e) {
        console.error(`获取结构失败: ${e.message}`);
        process.exit(1);
      }
    });

  // ── 短转储 ──
  program
    .command('dump')
    .description('查看短转储(DUMP)')
    .argument('[id]', 'DUMP ID（不传则列出所有）')
    .option('--from <time>', '起始时间 (YYYYMMDDHHMMSS)')
    .option('--json', 'JSON格式输出')
    .action(async (id, opts) => {
      try {
        if (id) {
          // 如果 ID 不是完整路径，先从列表中查找完整 ID
          let fullId = id;
          if (!id.includes('/') && !id.includes('%')) {
            const listRes = await client.request('GET', '/sap/bc/adt/runtime/dumps');
            const entryRegex = /<(?:atom:)?entry>([\s\S]*?)<\/(?:atom:)?entry>/g;
            let m;
            while ((m = entryRegex.exec(listRes.body)) !== null) {
              const eid = m[1].match(/<(?:atom:)?id>([^<]+)/)?.[1] || '';
              const ts = (eid.match(/\/(\d{14})/) || [])[1];
              if (ts === id) { fullId = eid.split('/').pop(); break; }
            }
          }
          const encodedId = fullId.includes('%') ? fullId : encodeURIComponent(fullId);
          const res = await client.request('GET', `/sap/bc/adt/runtime/dump/${encodedId}`);


            const title = res.body.match(/title="([^"]+)"/)?.[1] || '';
            const error = res.body.match(/error="([^"]+)"/)?.[1] || '';
            const prog = res.body.match(/terminatedProgram="([^"]+)"/)?.[1] || '';
            const author = res.body.match(/author="([^"]+)"/)?.[1] || '';
            const dt = res.body.match(/datetime="([^"]+)"/)?.[1] || '';
            const time = dt.replace('T', ' ').substring(0, 19);
            const exception = res.body.match(/exception="([^"]+)"/)?.[1] || '';

            // 解析章节（含分类、行号）
            const chapterList = [];
            const chRegex = /<dump:chapter\s+name="([^"]+)"\s+title="([^"]+)"\s+category="([^"]+)"\s+line="([^"]+)"\s+chapterOrder="([^"]+)"\s+categoryOrder="([^"]+)"/g;
            let cm;
            while ((cm = chRegex.exec(res.body)) !== null) {
              chapterList.push({ name: cm[1], title: cm[2], category: cm[3], line: parseInt(cm[4]), chapterOrder: parseInt(cm[5]), categoryOrder: parseInt(cm[6]) });
            }
            chapterList.sort((a, b) => a.chapterOrder - b.chapterOrder);

            // 按分类分组
            const chapterGroups = {};
            for (const ch of chapterList) {
              if (!chapterGroups[ch.category]) chapterGroups[ch.category] = [];
              chapterGroups[ch.category].push({ title: ch.title, line: ch.line });
            }

            // 解析链接
            const contUri = res.body.match(/relation="contents"\s+uri="([^"]+)"/)?.[1] || '';
            const summaryUri = res.body.match(/relation="[^"]*summary"\s+uri="([^"]+)"/)?.[1] || '';
            const termMatch = res.body.match(/relation="[^"]*termination"\s+uri="adt:\/\/\w+([^"]+)"/);
            const termination = termMatch ? termMatch[1] : null;
            let termSource = null;
            let termLine = null;
            if (termination) {
              const lm = termination.match(/#start=(\d+)/);
              termSource = termination.replace(/#start=\d+/, '');
              termLine = lm ? parseInt(lm[1]) : null;
            }

            // 获取格式化内容
            let contentText = '';
            if (contUri) {
              try {
                const contRes = await client.request('GET', contUri);
                contentText = contRes.body.replace(/\r/g, '');
              } catch(e) { /* ignore */ }
            }

            if (opts.json) {
              const cleanedContent = contentText ? cleanDumpText(contentText) : '';
              const parsedSections = contentText ? parseDumpSections(contentText) : [];
              const jsonObj = {
                dumpId: id,
                title: res.body.match(/title="([^"]+)"/)?.[1] || '',
                error: res.body.match(/error="([^"]+)"/)?.[1] || '',
                exception: res.body.match(/exception="([^"]+)"/)?.[1] || '',
                program: res.body.match(/terminatedProgram="([^"]+)"/)?.[1] || '',
                author: res.body.match(/author="([^"]+)"/)?.[1] || '',
                datetime: res.body.match(/datetime="([^"]+)"/)?.[1] || '',
                server: res.body.match(/serverInstance="([^"]+)"/)?.[1] || '',
                termination: termSource ? { uri: termSource, line: termLine } : null,
                chapters: chapterGroups,
                chapterList: chapterList.map(c => ({ title: c.title, category: c.category, line: c.line })),
                content: contentText,
                cleanedContent: cleanedContent,
                sections: parsedSections,
              };
              console.log(JSON.stringify(jsonObj, null, 2));
              return;
            }

            console.log(`\nDUMP 详情\n`);
            console.log(`  时间:      ${time}`);
            console.log(`  错误:      ${error}`);
            console.log(`  异常:      ${exception || '(无)'}`);
            console.log(`  程序:      ${prog}`);
            console.log(`  用户:      ${author}`);
            if (termSource) console.log(`  出错行:    ${termLine || '?'}`);
            console.log(`\n  章节 (${chapterList.length}):`);
            const categories = [...new Set(chapterList.map(c => c.category))];
            for (const cat of categories) {
              console.log(`\n  ${cat}:`);
              for (const ch of chapterList.filter(c => c.category === cat)) {
                console.log(`    - ${ch.title} (行 ${ch.line})`);
              }
            }


        } else {
          const fromVal = opts.from && opts.from.length === 8 ? opts.from + '000000' : opts.from;
          const url = '/sap/bc/adt/runtime/dumps' + (fromVal ? '?from=' + fromVal : '');
          const res = await client.request('GET', url);

          // 解析 Atom feed
          const entries = [];
          const entryRegex = /<(?:atom:)?entry>([\s\S]*?)<\/(?:atom:)?entry>/g;
          let m;
          while ((m = entryRegex.exec(res.body)) !== null) {
            const e = m[1];
            const title = e.match(/<(?:atom:)?title[^>]*>([^<]+)/)?.[1] || '';
            const time = e.match(/<(?:atom:)?updated>([^<]+)/)?.[1] || '';
            const errId = e.match(/<(?:atom:)?id>([^<]+)/)?.[1] || '';
            const shortId = (errId.match(/\/(\d{14})/) || [])[1] || errId.substring(0, 20);
            const fullId = errId.split('/').pop();
            entries.push({ id: shortId, fullId, title, time: time.replace('T', ' ').substring(0, 19) });
          }

          if (opts.json) {
            console.log(JSON.stringify({ count: entries.length, dumps: entries }, null, 2));
          } else if (entries.length === 0) {
            console.log('暂无短转储记录');
          } else {
            console.log(`短转储列表 (共 ${entries.length} 条)\n`);
            for (const e of entries) {
              console.log(`  ${e.time}  ${e.id} ${e.title}`);
            }
          }
        }
      } catch (e) {
        console.error(`获取DUMP失败: ${e.message}`);
        process.exit(1);
      }
    });

  // ── 消息类 ──
  program
    .command('message')
    .description('查看消息类')
    .argument('<name>', '消息类名')
    .option('--json', 'JSON格式输出')
    .action(async (msgName, opts) => {
      try {
        const name = msgName.toUpperCase();
        const metaRes = await client.request('GET', `/sap/bc/adt/messageclass/${name.toLowerCase()}`);
        if (metaRes.status !== 200) throw new Error(metaRes.body.match(/<message[^>]*>([^<]+)/)?.[1] || '未找到');

        // 解析消息（在 XML 中的 mc:messages 元素）
        const messages = [];
        const msgRe = /<mc:messages\s+mc:msgno="(\d+)"[^>]*mc:msgtext="([^"]*)"[^>]*>/g;
        let mm;
        while ((mm = msgRe.exec(metaRes.body)) !== null) {
          messages.push({ number: mm[1], text: mm[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') });
        }

        if (opts.json) {
          console.log(JSON.stringify({ name, count: messages.length, messages }, null, 2));
        } else {
          console.log(`\n消息类: ${name} (${messages.length} 条)\n`);
          for (const msg of messages) {
            console.log(`  ${msg.number}: ${msg.text}`);
          }
        }
      } catch (e) {
        console.error(`获取消息类失败: ${e.message}`);
        process.exit(1);
      }
    });

  // ── 文本元素 ──
  program
    .command('texts')
    .description('查看/修改文本元素')
    .argument('<name>', '程序/类/函数组名')
    .option('-t, --type <type>', '对象类型: program, class, function')
    .option('--json', 'JSON格式输出')
    .option('--set <sub>', '写入子对象: selections, symbols, headings')
    .option('--force-unlock', '写入前强制解锁')
    .option('--file <path>', '写入的文件路径（不传从stdin读取）')
    .action(async (objName, opts) => {
      try {
        const type = opts.type || guessType(objName);
        const name = objName.toUpperCase();

        // ── 写入模式 ──
        if (opts.set) {
          if (!['selections', 'symbols', 'headings'].includes(opts.set)) {
            console.error('--set 只支持: selections, symbols, headings');
            process.exit(1);
          }
          let source;
          if (opts.file) {
            source = fs.readFileSync(opts.file, 'utf8');
          } else {
            if (process.stdin.isTTY) throw new Error('请通过 --file 或管道传入内容');
            source = await new Promise((resolve, reject) => {
              const chunks = [];
              process.stdin.on('data', c => chunks.push(c));
              process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
              process.stdin.on('error', reject);
            });
          }

          let baseEp;
          switch (type) {
            case 'class':     baseEp = '/sap/bc/adt/textelements/classes'; break;
            case 'function':  baseEp = '/sap/bc/adt/textelements/functiongroups'; break;
            default:          baseEp = '/sap/bc/adt/textelements/programs';
          }
          const ctMap = {
            'symbols': 'application/vnd.sap.adt.textelements.symbols.v1',
            'selections': 'application/vnd.sap.adt.textelements.selections.v1',
            'headings': 'application/vnd.sap.adt.textelements.headings.v1',
          };
          const ct = ctMap[opts.set];
          const subPath = `${baseEp}/${name.toLowerCase()}/source/${opts.set}`;

          await client.autoConnect();

          const crypto = require('crypto');
          const sessHeaders = {
            'sap-adt-connection-id': crypto.randomUUID(),
            'x-sap-adt-sessiontype': 'stateful',
            'Cookie': client.cookie,
            'X-CSRF-Token': client.csrfToken,
          };

          // Force unlock (if requested via --force-unlock)
          if (opts.forceUnlock) {
            await client.rawRequest('POST', `${subPath}?_action=UNLOCK&lockHandle=0`, {
              body: '',
              headers: { 'Content-Type': 'application/atom+xml; type=entry', ...sessHeaders }
            }).catch(() => {});
            sessHeaders['sap-adt-connection-id'] = crypto.randomUUID();
          }

          // Lock
          const lockRes = await client.rawRequest('POST', `${subPath}?_action=LOCK&accessMode=MODIFY`, {
            body: '',
            headers: { 'Content-Type': 'application/atom+xml; type=entry', ...sessHeaders }
          });
          if (lockRes.status !== 200) throw new Error(`锁定失败: ${lockRes.body.match(/<message[^>]*>([^<]+)/)?.[1] || lockRes.status}`);

          const lockHandle = lockRes.body.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/i)?.[1];
          const corrNr = lockRes.body.match(/<CORRNR>([^<]+)<\/CORRNR>/i)?.[1];
          if (!lockHandle) throw new Error('获取 lockHandle 失败');

          try {
            const putRes = await client.rawRequest('PUT', `${subPath}?lockHandle=${encodeURIComponent(lockHandle)}&corrNr=${corrNr || ''}`, {
              body: source,
              headers: { 'Content-Type': ct, ...sessHeaders }
            });
            if (putRes.status !== 200) throw new Error(`写入失败: ${putRes.body.match(/<message[^>]*>([^<]+)/)?.[1] || putRes.status}`);
          } finally {
            await client.rawRequest('POST', `${subPath}?_action=UNLOCK&lockHandle=${encodeURIComponent(lockHandle)}`, {
              body: '',
              headers: { 'Content-Type': 'application/atom+xml; type=entry', ...sessHeaders }
            }).catch(() => {});
            // 调用 AI_PUT_UNLOCK 接口解锁
            try {
              const cfg = require('./config');
              const conn = cfg.getConnection();
              if (conn) {
                const http = require(conn.protocol === 'http' ? 'http' : 'https');
                const auth = Buffer.from(`${conn.user}:${conn.password}`).toString('base64');
                const postData = JSON.stringify({ GRAG: name });
                const options = {
                  hostname: conn.host,
                  port: conn.port || '44300',
                  path: `/sap/bc/zsx_intf_serv/zsx_oa?sap-client=${conn.client || '100'}&INTFID=AI_PUT_UNLOCK`,
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${auth}`,
                    'Content-Length': Buffer.byteLength(postData),
                  },
                  rejectUnauthorized: false,
                  timeout: 10000,
                };
                await new Promise((resolve) => {
                  const req = http.request(options, (res) => { res.resume(); res.on('end', resolve); });
                  req.on('error', () => resolve());
                  req.write(postData);
                  req.end();
                });
              }
            } catch (e) { /* 忽略 */ }
            client.destroy();
          }

          console.log(`写入成功: ${name} ${opts.set}`);
          return;
        }

        // ── 查看模式 ──
        let baseEndpoint;
        switch (type) {
          case 'class':     baseEndpoint = '/sap/bc/adt/textelements/classes'; break;
          case 'function':  baseEndpoint = '/sap/bc/adt/textelements/functiongroups'; break;
          default:          baseEndpoint = '/sap/bc/adt/textelements/programs';
        }

        const mainRes = await client.request('GET', `${baseEndpoint}/${name.toLowerCase()}`);
        if (mainRes.status !== 200) throw new Error(mainRes.body.match(/<message[^>]*>([^<]+)/)?.[1] || `HTTP ${mainRes.status}`);

        // 发现子对象：symbols, selections, headings
        const subRe = /<rept:subobject\s+adtcore:name="([^"]+)">/g;
        const subObjects = [];
        let sm;
        while ((sm = subRe.exec(mainRes.body)) !== null) subObjects.push(sm[1]);

        // content types per sub-object
        const contentTypes = {
          'symbols': 'application/vnd.sap.adt.textelements.symbols.v1',
          'selections': 'application/vnd.sap.adt.textelements.selections.v1',
          'headings': 'application/vnd.sap.adt.textelements.headings.v1',
        };

        // 获取每个子对象的文本
        const allTexts = {};
        for (const sub of subObjects) {
          try {
            const ct = contentTypes[sub] || 'text/plain';
            const subRes = await client.request('GET', `${baseEndpoint}/${name.toLowerCase()}/source/${sub}`, {
              headers: { 'Accept': ct }
            });
            if (subRes.status === 200) {
              const items = [];
              const lines = subRes.body.split('\n');
              for (const line of lines) {
                const m = line.match(/^(.+?)\s*=\s*(.*)/);
                if (m) {
                  const key = m[1].trim();
                  const text = m[2].trim();
                  if (key) items.push({ key, text });
                }
              }
              if (items.length > 0) allTexts[sub] = items;
            }
          } catch(e) {}
        }

        if (opts.json) {
          console.log(JSON.stringify({ name, type, ...allTexts }, null, 2));
        } else {
          const totalItems = Object.values(allTexts).reduce((s, a) => s + a.length, 0);
          console.log(`\n文本元素: ${name} (${totalItems} 条)\n`);
          const labels = { 'symbols': '文本符号', 'selections': '选择文本', 'headings': '标题' };
          for (const [sub, items] of Object.entries(allTexts)) {
            console.log(`\n  ${labels[sub] || sub} (${items.length}):`);
            for (const item of items) {
              console.log(`    ${item.key.padEnd(8)} ${item.text}`);
            }
          }
        }
      } catch (e) {
        console.error(`获取文本元素失败: ${e.message}`);
        process.exit(1);
      }
    });

  // ── 引用查询 ──
  program
    .command('refs')
    .description('Where-Used 引用查询')
    .argument('<name>', '对象名')
    .option('-t, --type <type>', '对象类型: program, class, table, interface, function')
    .option('--json', 'JSON格式输出')
    .action(async (objName, opts) => {
      try {
        const type = opts.type || guessType(objName);
        const name = objName.toUpperCase();
        const sourceUri = resolveAdtPath(name, type);
        const adtType = resolveAdtType(type);

        const body = `<?xml version="1.0" encoding="UTF-8"?>
<ur:usageReferenceRequest xmlns:ur="http://www.sap.com/adt/ris/usageReferences" xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="${sourceUri}" adtcore:type="${adtType}" adtcore:name="${name}"/>
</ur:usageReferenceRequest>`;

        const res = await client.request('POST', `/sap/bc/adt/repository/informationsystem/usageReferences?uri=${encodeURIComponent(sourceUri)}`, {
          body,
          headers: { 'Content-Type': 'application/vnd.sap.adt.repository.usagereferences.request.v1+xml' }
        });

        if (res.status !== 200) throw new Error(res.body.match(/<message[^>]*>([^<]+)/)?.[1] || `HTTP ${res.status}`);

        // 解析结果
        const refs = [];
        const objRe = /<usageReferences:referencedObject[^>]*uri="([^"]*)"[^>]*parentUri="([^"]*)"[^>]*>/g;
        let om;
        while ((om = objRe.exec(res.body)) !== null) {
          const fullTag = om[0];
          const uri = om[1];
          const parentUri = om[2] || '';
          const isResult = fullTag.includes('isResult="true"');
          if (!isResult) continue;
          // 从下一个 adtObject 中提取信息
          const nextObj = res.body.substring(om.index).match(/<usageReferences:adtObject[^>]*adtcore:name="([^"]*)"[^>]*adtcore:type="([^"]*)"[^>]*adtcore:description="([^"]*)"/);
          if (nextObj) {
            refs.push({ name: nextObj[1], type: nextObj[2], description: nextObj[3], uri });
          }
        }

        // Also try simpler regex - match adtObject inside referencedObject
        if (refs.length === 0) {
          const objRe2 = /<usageReferences:adtObject[^>]*adtcore:name="([^"]*)"[^>]*adtcore:type="([^"]*)"[^>]*adtcore:description="([^"]*)"/g;
          let om2;
          while ((om2 = objRe2.exec(res.body)) !== null) {
            const name2 = om2[1];
            if (name2 !== name) refs.push({ name: name2, type: om2[2], description: om2[3] });
          }
        }

        const typeMap = {
          'PROG/P': '程序', 'PROG/I': 'Include', 'CLAS/OC': '类', 'INTF/OI': '接口',
          'FUGR/F': '函数组', 'FUGR/FF': '函数模块', 'TABL/DT': '表', 'TABL/DS': '结构',
          'DDLS/DF': 'CDS视图', 'DEVC/K': '包', 'TRAN/T': '事务码', 'MSAG/N': '消息类',
        };

        if (opts.json) {
          console.log(JSON.stringify({ object: name, type, count: refs.length, references: refs }, null, 2));
        } else if (refs.length === 0) {
          console.log(`未找到引用 ${name} 的对象`);
        } else {
          console.log(`\n引用 ${name} 的对象 (${refs.length}):\n`);
          for (const ref of refs) {
            const typeLabel = typeMap[ref.type] || ref.type;
            console.log(`  ${ref.name.padEnd(35)} ${typeLabel.padEnd(8)} ${ref.description || ''}`);
          }
        }
      } catch (e) {
        console.error(`引用查询失败: ${e.message}`);
        process.exit(1);
      }
    });

  // ── 系统 ──  // ── 系统 ──  // ── 系统 ──
  program
    .command('system')
    .description('系统信息')
    .argument('<command>', '子命令: info, components')
    .option('--json', 'JSON格式输出')
    .action(async (cmd, opts) => {
      try {
        if (cmd === 'info') {
          const info = await client._getSystemInfo();
          jsonOrText(
            `系统信息\n  SID: ${info?.sid || '未知'}\n  SAP_BASIS: ${info?.basisVersion || '未知'}\n  Kernel: ${info?.kernel || '未知'}\n  服务器: ${info?.serverName || '未知'}`,
            info || { error: '获取失败' },
            opts.json
          );
        } else if (cmd === 'components') {
          const res = await client.request('GET', '/sap/bc/adt/system/components');
          // 解析 Atom feed
          const entries = [];
          const entryRe = /<(?:atom:)?entry>([\s\S]*?)<\/(?:atom:)?entry>/g;
          let em;
          while ((em = entryRe.exec(res.body)) !== null) {
            const e = em[1];
            const id = e.match(/<(?:atom:)?id>([^<]+)/)?.[1] || '';
            const title = e.match(/<(?:atom:)?title>([^<]+)/)?.[1] || '';
            const parts = title.split(';');
            entries.push({
              id,
              release: (parts[0] || '').trim(),
              patch: (parts[1] || '').trim(),
              spLevel: (parts[2] || '').trim(),
              description: (parts[3] || '').trim(),
            });
          }
          entries.sort((a, b) => a.id.localeCompare(b.id));
          if (opts.json) {
            console.log(JSON.stringify({ count: entries.length, components: entries }, null, 2));
          } else {
            console.log(`已安装组件 (共 ${entries.length} 个)\n`);
            console.log('组件ID'.padEnd(20) + '版本'.padEnd(8) + 'Patch'.padEnd(20) + 'SP'.padEnd(8) + '描述');
            console.log('-'.repeat(100));
            for (const e of entries) {
              console.log(e.id.padEnd(20) + e.release.padEnd(8) + e.patch.padEnd(20) + e.spLevel.padEnd(8) + e.description);
            }
          }
} else {
          console.error(`未知系统命令: ${cmd}，支持: info, components`);
          process.exit(1);
        }
      } catch (e) {
        console.error(`系统命令失败: ${e.message}`);
        process.exit(1);
      }
    });
      // 交互模式：无参数时进入 REPL
  if (process.argv.length <= 2) {
    const readline = require('readline');
    const { spawn } = require('child_process');

    const hr = () => '─'.repeat(Math.max(process.stdout.columns || 80, 40));

            // Banner
    const cfg = require('./config');
    const conn = cfg.showConnection();
    const pkg = require('../package.json');
    const B = '\x1b[94m'; // bright blue
    const W = '\x1b[97m'; // bright white
    const R = '\x1b[0m';   // reset
    const D = '\x1b[2m';   // dim

    const logo = [
      `${B} █████  ██   ██ ██   ██   ${W}█████  ██████   █████  ██████ ${R}`,
      `${B}██   ██  ██ ██   ██ ██   ${W}██   ██ ██   ██ ██   ██ ██   ██ ${R}`,
      `${B}██        ███     ███    ${W}███████ ██████  ███████ ██████ ${R}`,
      `${B}██ ███    ███     ███    ${W}██   ██ ██   ██ ██   ██ ██     ${R}`,
      `${B}██   ██  ██ ██   ██ ██   ${W}██   ██ ██   ██ ██   ██ ██     ${R}`,
      ` ${B}█████  ██   ██ ██   ██  ${W}██   ██ ██████  ██   ██ ██     ${R}`,
    ];

    console.log([
      '',
      ...logo,
      '',
      `  ${D}author: guoxiaoxi    version: v${pkg.version}${R}`,
      `  ${conn ? conn.host + ':' + (conn.port || '44300') + '  ' + D + conn.user + ' · Client ' + conn.client + R : '未配置'}`,
      `  ${process.cwd()}`,
      '',
    ].join('\n'));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '[34;1m❯[0m ',
    });

    let waiting = false;

    const showPrompt = () => {
      if (waiting) return;
      console.log(hr());
      rl.prompt();
    };

    showPrompt();

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) { showPrompt(); return; }
      if (trimmed === '.exit' || trimmed === '.quit') {
        console.log('再见');
        rl.close();
        process.exit(0);
        return;
      }

      waiting = true;
      const args = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g).map(s => s.replace(/^"|"$/g, ''));
      const child = spawn(process.execPath, [require('path').join(__dirname, '..', 'bin', 'gxx-abap.js'), ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
      let out = '';
      child.stdout.on('data', d => out += d);
      child.stderr.on('data', d => out += d);
      child.on('close', () => {
        if (out.trim()) {
          process.stdout.write(out.trimEnd() + '\n');
        }
        waiting = false;
        showPrompt();
      });
    });

    return;
  }

  program.parse(process.argv);
}

function extractSource(xmlBody) {
  if (xmlBody.trim().startsWith('<?xml')) {
    const match = xmlBody.match(/<content[^>]*>([\s\S]*?)<\/content>/);
    if (match) {
      return match[1]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    }
  }
  return xmlBody;
}

function guessType(name) {
  const upper = name.toUpperCase();
  if (upper.startsWith('CL_') || upper.startsWith('ZCL_')) return 'class';
  if (upper.startsWith('IF_') || upper.startsWith('ZIF_')) return 'interface';
  if (upper.startsWith('SAPL') || /^(Z|Y)\w{2,3}$/.test(upper)) return 'function';
  return 'program';
}

function resolveAdtPath(objPath, type) {
  if (objPath.startsWith('/sap/bc/adt/')) return objPath;
  const name = objPath.replace(/^.*[/\\\\]/, '');
  switch (type) {
    case 'class':     return `/sap/bc/adt/oo/classes/${name}/source/main`;
    case 'interface': return `/sap/bc/adt/oo/interfaces/${name}/source/main`;
    case 'table':     return `/sap/bc/adt/ddic/tables/${name.toLowerCase()}/source/main`;
    case 'function':  return `/sap/bc/adt/functions/groups/${name.toLowerCase()}/source/main`;

    case 'program':   return `/sap/bc/adt/programs/programs/${name}/source/main`;
    default:          return `/sap/bc/adt/programs/programs/${name}/source/main`;
  }
}

function resolveAdtBase(name, type) {
  const n = name.replace(/^.*[/\\\\]/, '').toLowerCase();
  switch (type) {
    case 'class':     return `/sap/bc/adt/oo/classes/${n}`;
    case 'interface': return `/sap/bc/adt/oo/interfaces/${n}`;
    case 'function':  return `/sap/bc/adt/functions/groups/${n}`;
    case 'program':   return `/sap/bc/adt/programs/programs/${n}`;
    default:          return `/sap/bc/adt/programs/programs/${n}`;
  }
}

function resolveAdtType(type) {
  switch (type) {
    case 'class':     return 'CLAS/OC';
    case 'interface': return 'INTF/OI';
    case 'function':  return 'FUGR/F';
    case 'program':   return 'PROG/P';
    default:          return 'PROG/P';
  }
}

function extractErrMsg(xmlBody) {
  const m = xmlBody.match(/<message[^>]*>([^<]+)/);
  return m ? m[1] : xmlBody.substring(0, 100);
}

function cleanDumpText(text) {
  const lines = text.split('\n');
  const cleaned = [];
  for (const line of lines) {
    // strip trailing spaces, then strip | borders
    let s = line.replace(/\s+$/, '');
    if (s.startsWith('|') && s.endsWith('|')) {
      s = s.slice(1, -1).trim();
    }
    if (s !== '' || (cleaned.length > 0 && cleaned[cleaned.length - 1] !== '')) {
      cleaned.push(s);
    }
  }
  while (cleaned.length > 0 && cleaned[cleaned.length - 1] === '') cleaned.pop();
  return cleaned.join('\n');
}

function stripPipes(s) {
  if (s.startsWith('|') && s.endsWith('|')) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function parseDumpSections(text) {
  const lines = text.split('\n');
  const sections = [];
  let current = null;
  let bodyLines = [];

  for (const line of lines) {
    let s = line.replace(/\s+$/, '');
    // separator line: all dashes
    if (s && /^-{10,}$/.test(s)) {
      if (current) {
        // clean body lines: strip pipes
        const cleanedBody = bodyLines.map(stripPipes).join('\n').replace(/\s+$/, '')
          .replace(/\n{3,}/g, '\n\n');
        if (cleanedBody) current.body = cleanedBody;
        sections.push(current);
      }
      current = null;
      bodyLines = [];
      continue;
    }
    if (!s && bodyLines.length === 0) continue;
    if (current === null) {
      current = { title: stripPipes(s) };
    } else {
      bodyLines.push(s);
    }
  }
  if (current) {
    const cleanedBody = bodyLines.map(stripPipes).join('\n').replace(/\s+$/, '')
      .replace(/\n{3,}/g, '\n\n');
    if (cleanedBody) current.body = cleanedBody;
    sections.push(current);
  }
  return sections;
}

module.exports = { run };
