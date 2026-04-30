/**
 * seed.js — 从提取的考点文本生成知识点数据并写入数据库
 * 运行: node server/seed.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import { config } from 'dotenv';

config();
const { Pool } = pg;
const __dir = dirname(fileURLToPath(import.meta.url));

// ─── 解析考点文本 ───────────────────────────────────────────────────

function parseExamPoints(text) {
  // 移除页眉标记和目录页
  const lines = text
    .split('\n')
    .filter(line => !/^={3,}/.test(line.trim()));

  // 找到第一个实际内容（非目录）的考点起始位置
  // 目录中的考点格式: "考点 N title ........... N"
  // 内容中的考点格式: "考点 N title" (没有点线)
  const contentLines = [];
  let inToc = true;
  for (const line of lines) {
    if (inToc && /^考点 \d+/.test(line) && !line.includes('...')) {
      inToc = false;
    }
    if (!inToc) contentLines.push(line);
  }

  // 按"考点 N"分割
  const sections = [];
  let currentSection = null;
  for (const line of contentLines) {
    const match = line.match(/^考点 (\d+)\s+(.+)$/);
    if (match) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        num: parseInt(match[1]),
        title: match[2].trim(),
        lines: [],
      };
    } else if (currentSection) {
      currentSection.lines.push(line);
    }
  }
  if (currentSection) sections.push(currentSection);

  return sections.filter(s => s.lines.some(l => l.trim()));
}

// ─── 模块和优先级映射 ───────────────────────────────────────────────

// Title-first rules (checked against title only, highest priority)
const TITLE_RULES = [
  { pattern: /ABSD|基于架构的软件设计/, module: '系统架构设计', priority: 'P0' },
  { pattern: /DSSA|特定领域软件架构/, module: '系统架构设计', priority: 'P0' },
  { pattern: /CBSE|基于构件的软件工程/, module: '系统架构设计', priority: 'P0' },
  { pattern: /ATAM|SAAM|架构权衡|敏感点|权衡点/, module: '系统架构设计', priority: 'P0' },
  { pattern: /软件架构风格|架构风格/, module: '系统架构设计', priority: 'P0' },
  { pattern: /质量属性/, module: '系统架构设计', priority: 'P0' },
  { pattern: /4\+1|"4\+1"|4．1/, module: '系统架构设计', priority: 'P0' },
  { pattern: /中台/, module: '系统架构设计', priority: 'P0' },
  { pattern: /微服务|SOA|面向服务的架构/, module: '分布式架构', priority: 'P1' },
  { pattern: /云原生/, module: '分布式架构', priority: 'P1' },
  { pattern: /可靠性指标|MTTF|MTBF|主动冗余|被动冗余|恢复块|N版本/, module: '系统架构设计', priority: 'P0' },
  { pattern: /大数据|Hadoop|Kappa|Lambda|HDFS|MapReduce|Spark/, module: '大数据', priority: 'P2' },
  { pattern: /Redis|缓存|负载均衡|高并发/, module: 'Web与高并发', priority: 'P1' },
  { pattern: /知识产权|侵权|保护期|著作权|专利/, module: '法律与知识产权', priority: 'P3' },
  { pattern: /数字化转型|电子政务|信息系统战略|企业集成|系统工程|信息工程/, module: '信息化与系统工程', priority: 'P2' },
  { pattern: /UML图|面向对象设计原则|设计模式|聚合|耦合|模块独立性/, module: '面向对象', priority: 'P1' },
  { pattern: /信息安全|加密|密钥|摘要算法|攻击|安全保护|WPD/, module: '信息安全', priority: 'P2' },
  { pattern: /TCP|UDP|WPDRRC|协议簇|区块链/, module: '计算机网络', priority: 'P2' },
  { pattern: /数学建模/, module: '综合', priority: 'P3' },
];

const MODULE_RULES = [
  { keywords: ['CPU', '中央处理单元', '嵌入式微处理器', '总线', '流水线', '存储器', '计算机组成', '主频', 'MIPS', 'Cache'], module: '计算机组成', priority: 'P2' },
  { keywords: ['数据库', '范式', '关系型', 'NoSQL', '封锁协议', '事务', '备份', '三级模式', '两层映射', '分表', '分区', '主从数据库', '反规范化'], module: '数据库', priority: 'P1' },
  { keywords: ['Redis', '缓存', '负载均衡', '集群', 'MVC', 'REST', '高并发', '静态化', 'Memcach', 'CDN'], module: 'Web与高并发', priority: 'P1' },
  { keywords: ['UML', '面向对象', '设计原则', '设计模式', '类图', '用例', '序列图', '状态图', '活动图', '聚合', '耦合', '模块独立性'], module: '面向对象', priority: 'P1' },
  { keywords: ['信息安全', '加密', '密钥', '摘要', '攻击', 'RSA', 'DES', '安全等级', '防火墙', '数字签名', '证书'], module: '信息安全', priority: 'P2' },
  { keywords: ['软件工程', '瀑布', '螺旋', '增量', '原型法', '敏捷', 'CMMI', '统一过程', 'RUP', '需求', '维护', '结构化开发', '遗留系统', '新旧系统', '再工程', '重构'], module: '软件工程', priority: 'P1' },
  { keywords: ['ABSD', 'DSSA', 'CBSE', 'ATAM', 'SAAM', '敏感点', '权衡点', '质量属性', '架构风格', '架构评估', '架构'], module: '系统架构设计', priority: 'P0' },
  { keywords: ['微服务', 'SOA', '云原生', '容器', 'Docker', 'Kubernetes', '服务网格', '中台', '分布式'], module: '分布式架构', priority: 'P1' },
  { keywords: ['大数据', 'Hadoop', 'Spark', 'Kappa', 'Lambda', 'HDFS', 'MapReduce', '数据中台', '区块链'], module: '大数据', priority: 'P2' },
  { keywords: ['信息化', '企业信息化', '电子政务', '信息系统战略', '信息系统分类', 'ISSP', '数字化转型', '系统工程', '信息工程', 'Agent'], module: '信息化与系统工程', priority: 'P2' },
  { keywords: ['可行性', '知识产权', '侵权', '保护期', '著作权', '专利'], module: '法律与知识产权', priority: 'P3' },
  { keywords: ['MTTF', 'MTBF', '主动冗余', '被动冗余', '恢复块', 'N版本', '数学建模'], module: '可靠性与数学', priority: 'P2' },
];

function inferModule(title, content) {
  // Check title-only rules first (most reliable)
  for (const rule of TITLE_RULES) {
    if (rule.pattern.test(title)) {
      return { module: rule.module, priority: rule.priority };
    }
  }
  // Fallback to content-aware rules
  const text = title + ' ' + content.slice(0, 200);
  for (const rule of MODULE_RULES) {
    if (rule.keywords.some(kw => text.includes(kw))) {
      return { module: rule.module, priority: rule.priority };
    }
  }
  return { module: '综合', priority: 'P2' };
}

// ─── 生成 Q&A ───────────────────────────────────────────────────────

function generateQA(title, content) {
  // 提取关键问答
  const lines = content.split('\n').filter(l => l.trim());

  // 优先寻找对比、分类等关键结构
  const firstPara = lines
    .slice(0, 8)
    .filter(l => l.trim() && !l.match(/^\d+$/) && l.trim().length > 4)
    .slice(0, 3)
    .join(' ')
    .slice(0, 300);

  // 简化的Q&A生成
  const question = `请说明「${title}」的核心概念或要点`;
  const answer = firstPara || `见考点内容：${title}`;

  return { question, answer };
}

// ─── 生成 ID ────────────────────────────────────────────────────────

function makeId(num, title) {
  const slug = title
    .replace(/[（）()【】\[\]、，。：:,. ·—]/g, '-')
    .replace(/[^\u4e00-\u9fff\w-]/g, '')
    .slice(0, 20)
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `kp-${String(num).padStart(3, '0')}-${slug}`;
}

// ─── 静态数据：20周计划 ────────────────────────────────────────────

const studyPlan = [
  { id: 'week-01', week: 1, title: '考试大纲、导学课、核心考点目录、2024 真题摸底', phase: '框架建立', focus: '建立知识地图，生成第一批卡片和薄弱点清单。' },
  { id: 'week-02', week: 2, title: '核心考点提炼 1-30：软件工程、信息系统、需求', phase: '框架建立', focus: '把高频名词做成概念卡和对比卡。' },
  { id: 'week-03', week: 3, title: '操作系统、计算机组成', phase: '上午基础', focus: '进程、死锁、存储、CPU、Cache、流水线。' },
  { id: 'week-04', week: 4, title: '数据库设计专项', phase: '上午基础', focus: '范式、关系代数、封锁协议、备份恢复、NoSQL。' },
  { id: 'week-05', week: 5, title: '软件工程、需求工程、测试与维护', phase: '上午基础', focus: '生命周期模型、UP/RUP、敏捷、需求变更、测试。' },
  { id: 'week-06', week: 6, title: '面向对象、UML、设计模式、项目管理', phase: '上午基础', focus: 'UML 图、设计原则、模式、项目管理送分点。' },
  { id: 'week-07', week: 7, title: '架构基础、构件、4+1 视图、架构风格', phase: '核心架构', focus: 'P0 核心，开始做案例表达。' },
  { id: 'week-08', week: 8, title: 'ABSD、DSSA、CBSE、软件复用', phase: '核心架构', focus: '背定义，练习"方法步骤+适用场景"。' },
  { id: 'week-09', week: 9, title: '质量属性、可靠性、性能', phase: '核心架构', focus: '所有质量属性都写成场景化表达。' },
  { id: 'week-10', week: 10, title: '架构评估、ATAM、敏感点、权衡点', phase: '核心架构', focus: '形成案例题标准答题框架。' },
  { id: 'week-11', week: 11, title: '传统案例：软件工程、数据库、Web 应用', phase: '案例专项', focus: '每天 1 道案例小题。' },
  { id: 'week-12', week: 12, title: '架构案例：信息系统、层次架构、架构风格', phase: '案例专项', focus: '按题干识别架构风格与质量属性。' },
  { id: 'week-13', week: 13, title: '云原生、SOA、微服务、安全架构', phase: '案例专项', focus: '补充热点技术和安全答题素材。' },
  { id: 'week-14', week: 14, title: '大数据、Hadoop、Redis、高并发', phase: '案例专项', focus: '高并发和大数据可同时服务论文。' },
  { id: 'week-15', week: 15, title: '论文模板：云原生/服务网格', phase: '论文专项', focus: '完成第一篇可背诵模板。' },
  { id: 'week-16', week: 16, title: '论文模板：高并发性能优化', phase: '论文专项', focus: '结合工作项目改写成自己的经历。' },
  { id: 'week-17', week: 17, title: '论文模板：大数据/Kappa、安全可靠', phase: '论文专项', focus: '完成 4 篇模板和素材库。' },
  { id: 'week-18', week: 18, title: '2024、2025 真题优先做', phase: '真题冲刺', focus: '按错题反查知识点。' },
  { id: 'week-19', week: 19, title: '2018-2023 真题轮刷与案例复盘', phase: '真题冲刺', focus: '限时练习，整理固定答题模板。' },
  { id: 'week-20', week: 20, title: '模拟机考、论文背诵、考前必背清单', phase: '真题冲刺', focus: '只复习 P0/P1、错题、论文模板。' },
];

// ─── 静态数据：论文模板 ─────────────────────────────────────────────

const paperTemplates = [
  {
    id: 'paper-cloud-native',
    title: '云原生/服务网格架构设计',
    use_for: '云原生、微服务治理、服务网格、可观测性、弹性伸缩。',
    structure: ['项目背景', '业务挑战', '总体架构', '服务治理与安全', '效果评价'],
    content_md: `## 摘要
2021年6月至2023年12月，我担任某金融科技公司的系统架构师，主持了核心交易系统云原生改造项目。项目历时18个月，投入12人，成功交付并获得客户好评。本文论述基于服务网格的云原生架构设计与实践。

## 项目背景
随着业务规模增长，原有单体架构面临部署耦合、扩展困难、多语言支持缺失等问题。决策采用云原生架构，以容器化、微服务和服务网格为核心技术方向。

## 总体架构设计
- **服务层**：将单体拆分为20+微服务，采用领域驱动设计（DDD）划分边界
- **通信层**：引入 Istio 服务网格，Sidecar 代理（Envoy）接管所有服务间通信
- **观测层**：Prometheus + Grafana 指标、Jaeger 链路追踪、EFK 日志
- **弹性层**：基于 Kubernetes HPA 的自动扩缩容，Pod 副本数 2-20 动态调整

## 关键技术
- 流量管理：金丝雀发布（10%→30%→100%），蓝绿部署，故障注入测试
- 安全：mTLS 双向认证，RBAC 访问控制，服务间零信任
- 可靠性：熔断（Hystrix语义），限流（100 QPS），重试（3次，退避1s）

## 效果评价
- 部署频率：从月均 2 次提升至每日 15 次
- 服务可用性：99.95%（原 99.5%）
- 故障定位时间：从平均 2 小时降至 8 分钟`,
  },
  {
    id: 'paper-high-concurrency',
    title: '高并发系统性能优化',
    use_for: '秒杀、交易、支付、预约、内容平台、流量突增系统。',
    structure: ['性能目标', '缓存与异步', '负载均衡', '数据库优化', '限流降级与监控'],
    content_md: `## 摘要
2022年1月至2023年6月，我担任某电商平台系统架构师，主持大促活动高并发性能优化项目。系统峰值 QPS 从 5 万提升至 50 万，项目历时 18 个月，成功支撑双11大促零故障运行。

## 性能目标
- 峰值 QPS：50万（基准 5 万，提升 10 倍）
- P99 响应时间：≤ 200ms
- 可用性：99.99%（全年宕机 < 52 分钟）

## 缓存策略
- **多级缓存**：本地缓存（Caffeine）→ 分布式缓存（Redis Cluster）→ 数据库
- **热点探测**：实时监控访问频率，自动将热点商品推入本地缓存
- **缓存穿透**：布隆过滤器拦截无效 ID 查询
- **缓存击穿**：分布式锁（Redisson）防止缓存失效时的并发穿透

## 异步化与消息队列
- 订单创建解耦：下单 → MQ（Kafka）→ 库存扣减/支付/通知异步处理
- 削峰：消费者限速处理，入队成功即返回"处理中"，用户轮询结果

## 数据库优化
- 分库分表：按用户ID哈希分16个库×32张表（ShardingSphere）
- 读写分离：主库写，3个从库读，binlog 同步延迟 < 50ms
- 索引优化：覆盖索引消除回表，慢查询优化（EXPLAIN 分析）

## 限流降级
- 接口限流：令牌桶算法（Sentinel），超限返回友好提示
- 服务降级：非核心功能（推荐、评论）降级，保障核心链路
- 熔断：连续失败 5 次触发熔断，10s 后半开探测`,
  },
  {
    id: 'paper-kappa',
    title: 'Kappa 架构实时数据处理',
    use_for: '日志分析、风控、推荐、实时指标、数据中台。',
    structure: ['数据采集', '流处理', '存储设计', '一致性与容错', '业务效果'],
    content_md: `## 摘要
2021年3月至2022年9月，我担任某互联网公司大数据架构师，主持实时数据处理平台重构项目。将原有 Lambda 架构迁移至 Kappa 架构，实现批流一体，数据延迟从小时级降至秒级。

## 背景与挑战
原 Lambda 架构的痛点：
- 批处理（Spark）和流处理（Flink）两套代码逻辑维护成本高
- 批处理结果与实时结果偶发不一致
- 数据修正需重跑批任务，耗时 4-6 小时

## Kappa 架构设计
**核心思路**：仅保留流处理路径，历史数据通过"重放"消息队列实现批处理语义。

- **数据采集**：Kafka（保留7天历史日志，支持任意位点重放）
- **流处理引擎**：Flink（Exactly-Once 语义，状态后端 RocksDB）
- **存储层**：
  - 实时结果 → Redis（低延迟读取）
  - 历史聚合 → ClickHouse（OLAP 分析）
  - 原始数据 → HDFS（归档备份）

## 一致性保障
- Flink Checkpoint（每30s），故障恢复从最近 Checkpoint 继续
- Kafka 事务 + Flink Two-Phase Commit 保证 Exactly-Once
- 数据重放时通过 Watermark 处理乱序事件（允许5秒延迟）

## 效果
- 数据延迟：小时级 → 秒级（P99 < 3s）
- 代码量减少 60%（去除批处理逻辑）
- 数据一致性：批流结果偏差从 0.3% 降至 0%`,
  },
  {
    id: 'paper-security-reliability',
    title: '安全与可靠性架构设计',
    use_for: '政企系统、金融系统、核心业务系统、7x24 小时系统。',
    structure: ['安全目标', '访问控制', '加密审计', '冗余容灾', '可靠性评估'],
    content_md: `## 摘要
2020年6月至2022年3月，我担任某银行核心业务系统架构师，主持系统安全加固与高可用改造项目。系统年可用性从 99.9% 提升至 99.999%（5个9），通过等保三级认证。

## 安全架构设计

### 访问控制
- **认证**：OAuth 2.0 + JWT（15分钟有效期）+ 刷新令牌（7天）
- **授权**：RBAC（角色-资源-操作），最小权限原则
- **多因素**：核心操作（转账、修改权限）要求短信/硬件令牌二次验证

### 传输与存储加密
- 传输层：TLS 1.3，禁用弱密码套件
- 敏感字段：AES-256-GCM 对称加密存储（密钥由 HSM 管理）
- 密码：bcrypt（cost=12）单向哈希，禁止明文存储
- 数字签名：RSA-2048 对交易数据签名，防篡改

### 审计与监控
- 全量操作日志（不可删除，写入独立审计库）
- 异常检测：异地登录、非常规时间操作触发告警
- SIEM 系统实时分析安全事件

## 高可用架构

### 冗余设计
- 双活数据中心（同城）+ 异地灾备中心
- 数据库：MGR（MySQL Group Replication）3节点，RPO=0，RTO<30s
- 应用层：无状态设计，Kubernetes 多副本，跨机架反亲和

### 故障恢复
- 自动故障检测（心跳超时3次触发）→ 自动切换（DNS+VIP）
- 混沌工程：每季度模拟单机房故障演练

## 可靠性指标
- MTTF（平均无故障时间）：8760 小时（1年）
- MTTR（平均修复时间）：< 5 分钟
- 可用性：99.999%（年停机 < 5.26 分钟）`,
  },
];

// ─── 主函数 ─────────────────────────────────────────────────────────

async function main() {
  const textPath = process.env.SEED_TEXT_PATH
    || join(__dir, '../../.copilot/session-state/cd78653b-4a7b-4329-94f9-bbd5a5cd262f/files/extracted/2024年系统架构设计师核心考点提炼.txt')
    || '/root/.copilot/session-state/cd78653b-4a7b-4329-94f9-bbd5a5cd262f/files/extracted/2024年系统架构设计师核心考点提炼.txt';
  let text;
  try {
    text = readFileSync(textPath, 'utf8');
  } catch {
    console.error('❌ 找不到提取的文本文件，尝试使用备用路径');
    process.exit(1);
  }

  const sections = parseExamPoints(text);
  console.log(`📖 解析到 ${sections.length} 个考点`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // 清空并重新插入（幂等）
    await pool.query('TRUNCATE TABLE wrong_items, card_progress, knowledge_points RESTART IDENTITY CASCADE');
    await pool.query('TRUNCATE TABLE paper_templates, study_plan');
    console.log('🗑️  旧数据已清空');

    // 插入知识点
    let inserted = 0;
    for (const section of sections) {
      const content = section.lines.join('\n').trim();
      if (!content || content.length < 5) continue;

      const id = makeId(section.num, section.title);
      const { module, priority } = inferModule(section.title, content);
      const summary = content.split('\n').find(l => l.trim().length > 10)?.trim().slice(0, 120) ?? section.title;
      const { question, answer } = generateQA(section.title, content);

      await pool.query(
        `INSERT INTO knowledge_points (id, priority, module, title, summary, content_md, question, answer)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           priority=EXCLUDED.priority, module=EXCLUDED.module, title=EXCLUDED.title,
           summary=EXCLUDED.summary, content_md=EXCLUDED.content_md,
           question=EXCLUDED.question, answer=EXCLUDED.answer`,
        [id, priority, module, section.title, summary, content, question, answer]
      );

      // 初始化卡片进度
      await pool.query(
        `INSERT INTO card_progress (id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [id]
      );
      inserted++;
    }
    console.log(`✅ 知识点已写入：${inserted} 条`);

    // 插入学习计划
    for (const item of studyPlan) {
      await pool.query(
        `INSERT INTO study_plan (id, week, title, phase, focus, status) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, phase=EXCLUDED.phase, focus=EXCLUDED.focus`,
        [item.id, item.week, item.title, item.phase, item.focus, 'pending']
      );
    }
    // 第一周设为 in-progress
    await pool.query(`UPDATE study_plan SET status='in-progress' WHERE id='week-01'`);
    console.log('✅ 学习计划已写入：20 周');

    // 插入论文模板
    for (const t of paperTemplates) {
      await pool.query(
        `INSERT INTO paper_templates (id, title, use_for, structure, content_md) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, use_for=EXCLUDED.use_for, structure=EXCLUDED.structure, content_md=EXCLUDED.content_md`,
        [t.id, t.title, t.use_for, JSON.stringify(t.structure), t.content_md]
      );
    }
    console.log('✅ 论文模板已写入：4 篇');

    // 统计
    const stats = await pool.query(`
      SELECT
        (SELECT count(*) FROM knowledge_points) AS kp,
        (SELECT count(*) FROM card_progress) AS cp,
        (SELECT count(*) FROM study_plan) AS sp,
        (SELECT count(*) FROM paper_templates) AS pt
    `);
    const s = stats.rows[0];
    console.log(`\n📊 数据库统计：`);
    console.log(`   知识点：${s.kp} 条`);
    console.log(`   卡片进度：${s.cp} 条`);
    console.log(`   学习计划：${s.sp} 周`);
    console.log(`   论文模板：${s.pt} 篇`);

  } finally {
    await pool.end();
  }
}

main().catch(e => {
  console.error('❌ Seed 失败:', e.message);
  process.exit(1);
});
