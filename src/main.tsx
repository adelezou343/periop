import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { assessmentModules } from "./modules/assessments/modules";
import type { AssessmentId, AssessmentField, PatientProfile, AssessmentResult } from "./types/assessment";

const initialPatient: PatientProfile = {
  patientId: "P-8821",
  age: "",
  sex: "未填写",
  surgeryName: "",
  history: "",
  medications: "",
};

const navItems = [
  { id: "clinical" as AssessmentId, label: "临床资料", icon: "person" },
  ...assessmentModules.map((module) => ({ id: module.id, label: module.title, icon: module.icon })),
  { id: "summary" as AssessmentId, label: "总报告", icon: "description" },
];

function Icon({ name }: { name: string }) {
  return <span className="material-symbols-outlined">{name}</span>;
}

function App() {
  const [activeView, setActiveView] = useState<AssessmentId>("summary");
  const [patient, setPatient] = useState<PatientProfile>(initialPatient);
  const [inputs, setInputs] = useState<Record<string, Record<string, string | boolean>>>({});
  const [copyState, setCopyState] = useState("复制病历文本");

  const results = useMemo(
    () => assessmentModules.map((module) => module.evaluate(inputs[module.id] ?? {}, patient)),
    [inputs, patient],
  );

  const activeModule = assessmentModules.find((module) => module.id === activeView);

  function updatePatient<K extends keyof PatientProfile>(key: K, value: PatientProfile[K]) {
    setPatient((current) => ({ ...current, [key]: value }));
  }

  function updateAssessment(moduleId: string, fieldId: string, value: string | boolean) {
    setInputs((current) => ({
      ...current,
      [moduleId]: {
        ...(current[moduleId] ?? {}),
        [fieldId]: value,
      },
    }));
  }

  async function copyReport() {
    const text = buildReportText(patient, results);
    await navigator.clipboard.writeText(text);
    setCopyState("已复制");
    window.setTimeout(() => setCopyState("复制病历文本"), 1600);
  }

  return (
    <>
      <header className="topbar no-print">
        <div className="brand">
          <div className="brandIcon">
            <Icon name="clinical_notes" />
          </div>
          <div>
            <h1>围术期器官功能评估</h1>
            <p>患者ID：{patient.patientId || "未填写"}</p>
          </div>
        </div>
        <div className="topActions">
          <button className="primaryButton" onClick={() => window.print()}>
            <Icon name="picture_as_pdf" />
            <span>打印/另存PDF</span>
          </button>
          <button className="ghostButton" onClick={copyReport}>
            <Icon name="content_copy" />
            <span>{copyState}</span>
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar no-print">
          <div className="sidebarInner">
            <p className="sidebarTitle">Assessment Steps</p>
            <nav className="sideNav">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  className={activeView === item.id ? "navItem active" : "navItem"}
                  onClick={() => setActiveView(item.id)}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          </div>
          <div className="privacyNote">
            <div>
              <Icon name="verified_user" />
              <strong>本地会话</strong>
            </div>
            <p>数据仅在当前浏览器页面中计算，不上传服务器。</p>
          </div>
        </aside>

        <main className="mainCanvas">
          {activeView === "clinical" && <ClinicalData patient={patient} onChange={updatePatient} />}
          {activeModule && (
            <AssessmentEditor
              module={activeModule}
              values={inputs[activeModule.id] ?? {}}
              result={results.find((result) => result.moduleId === activeModule.id)}
              onChange={(fieldId, value) => updateAssessment(activeModule.id, fieldId, value)}
            />
          )}
          {activeView === "summary" && <Summary patient={patient} results={results} onEditClinical={() => setActiveView("clinical")} />}
        </main>
      </div>

      <nav className="mobileNav no-print">
        {[
          { id: "clinical" as AssessmentId, label: "资料", icon: "edit_note" },
          { id: "cardiac" as AssessmentId, label: "心脏", icon: "favorite" },
          { id: "pulmonary" as AssessmentId, label: "肺部", icon: "air" },
          { id: "thrombosis" as AssessmentId, label: "血栓", icon: "warning" },
          { id: "summary" as AssessmentId, label: "总评", icon: "assignment_turned_in" },
        ].map((item) => (
          <button key={item.id} className={activeView === item.id ? "mobileItem active" : "mobileItem"} onClick={() => setActiveView(item.id)}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

function ClinicalData({ patient, onChange }: { patient: PatientProfile; onChange: <K extends keyof PatientProfile>(key: K, value: PatientProfile[K]) => void }) {
  return (
    <section>
      <PageHeading title="患者临床资料" subtitle="录入通用病史和手术信息；这些信息会被各系统评估和总报告引用。" />
      <div className="formGrid">
        <Field label="患者ID"><input value={patient.patientId} onChange={(event) => onChange("patientId", event.target.value)} /></Field>
        <Field label="年龄"><input type="number" value={patient.age} onChange={(event) => onChange("age", event.target.value)} /></Field>
        <Field label="性别">
          <select value={patient.sex} onChange={(event) => onChange("sex", event.target.value)}>
            <option>未填写</option>
            <option>男</option>
            <option>女</option>
          </select>
        </Field>
        <Field label="拟行手术"><input value={patient.surgeryName} onChange={(event) => onChange("surgeryName", event.target.value)} placeholder="如腹腔镜胆囊切除术" /></Field>
        <Field label="既往史" wide><textarea value={patient.history} onChange={(event) => onChange("history", event.target.value)} placeholder="高血压、糖尿病、卒中、冠心病、COPD、肝硬化等" /></Field>
        <Field label="当前用药" wide><textarea value={patient.medications} onChange={(event) => onChange("medications", event.target.value)} placeholder="抗凝、抗血小板、降压药、降糖药、利尿剂等" /></Field>
      </div>
    </section>
  );
}

function AssessmentEditor({
  module,
  values,
  result,
  onChange,
}: {
  module: (typeof assessmentModules)[number];
  values: Record<string, string | boolean>;
  result?: AssessmentResult;
  onChange: (fieldId: string, value: string | boolean) => void;
}) {
  const subtitle = result?.configured
    ? "录入已获得的临床资料和检查结果；未填写的项目不会参与判断，最终风险按已输入资料中的最高风险处理。"
    : "先记录评估所需资料；待正式评估表导入后，本模块会输出对应评分、分层和建议。";

  return (
    <section>
      <PageHeading title={module.title} subtitle={subtitle} />
      <div className="editorSplit">
        <div className="editorMain">
          <div className="formGrid single">
            {module.fields.map((field) => (
              <AssessmentInput key={field.id} field={field} value={values[field.id]} onChange={(value) => onChange(field.id, value)} />
            ))}
          </div>
          {module.id === "cardiac" && <CardiacSurgicalRiskReference />}
        </div>
        {result && <ResultPanel result={result} />}
      </div>
    </section>
  );
}

function CardiacSurgicalRiskReference() {
  const columns = [
    {
      title: "低风险（<1%）",
      items: [
        "浅表手术",
        "乳腺手术",
        "牙科手术",
        "甲状腺手术",
        "眼科手术",
        "无症状的颈动脉狭窄手术：颈动脉内膜剥脱或支架术",
        "妇科手术：轻微（如宫颈锥切）",
        "骨科手术：轻微（如半月板切除）",
        "泌外手术：轻微（如经尿道前列腺切除）",
      ],
    },
    {
      title: "中等风险（1%-5%）",
      items: [
        "腹腔内手术：脾切除、食管裂孔疝修复、胆囊切除术",
        "有症状的颈动脉狭窄手术：颈动脉内膜剥脱或支架术",
        "外周动脉成形术",
        "血管内动脉瘤修补术",
        "头颈部手术",
        "神经或骨科手术：大手术（如髋部或脊柱手术）",
        "泌尿外科或妇科手术：大手术（如肾移植手术）",
        "胸腔手术：非大手术",
      ],
    },
    {
      title: "高风险（>5%）",
      items: [
        "主动脉和大血管手术",
        "切开下肢的血管再通、截肢或取栓术",
        "十二指肠/胰腺手术",
        "肝切除、胆道手术",
        "食管切除术",
        "肠穿孔修补术",
        "肾上腺切除术",
        "膀胱全切术",
        "肺切除术",
        "肺或肝移植",
      ],
    },
  ];

  return (
    <section className="referencePanel">
      <div className="referenceHeader">
        <Icon name="table_chart" />
        <div>
          <h3>手术本身心血管风险参考</h3>
          <p>选择上方“手术本身心血管风险”时，可按下表快速定位。</p>
        </div>
      </div>
      <div className="referenceGrid">
        {columns.map((column) => (
          <div className="referenceColumn" key={column.title}>
            <h4>{column.title}</h4>
            <ul>
              {column.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function AssessmentInput({ field, value, onChange }: { field: AssessmentField; value: string | boolean | undefined; onChange: (value: string | boolean) => void }) {
  if (field.type === "checkbox") {
    return (
      <label className="checkRow">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span>{field.label}</span>
      </label>
    );
  }

  return (
    <Field label={field.label}>
      <div className="unitWrap">
        {field.type === "textarea" ? (
          <textarea value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} />
        ) : field.type === "select" ? (
          <select value={String(value ?? field.options?.[0] ?? "")} onChange={(event) => onChange(event.target.value)}>
            {field.options?.map((option) => <option key={option}>{option}</option>)}
          </select>
        ) : (
          <input type={field.type} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} />
        )}
        {field.unit && <span className="unit">{field.unit}</span>}
      </div>
    </Field>
  );
}

function Summary({ patient, results, onEditClinical }: { patient: PatientProfile; results: AssessmentResult[]; onEditClinical: () => void }) {
  return (
    <>
      <section className="summaryHeader">
        <div>
          <h2>围术期综合评估报告</h2>
          <div className="metaLine">
            <span><Icon name="badge" /> {patient.patientId || "未填写患者ID"}</span>
            <span className="codePill">拟行手术：{patient.surgeryName || "未填写"}</span>
          </div>
        </div>
        <button className="secondaryButton no-print" onClick={onEditClinical}>
          <Icon name="edit_note" />
          返回资料录入
        </button>
      </section>

      <div className="riskGrid">
        {results.map((result, index) => <RiskCard key={result.moduleId} result={result} featured={index === 0} />)}
        <div className="compositeCard">
          <p>Patient Summary</p>
          <h3>{patient.age ? `${patient.age}岁` : "年龄未填"}</h3>
          <span>{patient.sex || "性别未填"} · {patient.surgeryName || "未填写拟行手术"}</span>
          <Icon name="health_and_safety" />
        </div>
      </div>

      <section className="recommendations">
        <div className="sectionTitle">
          <Icon name="assignment_turned_in" />
          <h2>围术期建议</h2>
        </div>
        <div className="recommendationGrid">
          <RecommendationColumn
            title="术前"
            items={[
              ["fact_check", "完善资料核对", "确认五个系统评估表均已导入并完成评分后，再形成正式结论。"],
              ["science", "系统资料复核", "按卒中、心脏、肺部、血栓和肝脏模块分别补充相应检查与评分资料。"],
            ]}
          />
          <RecommendationColumn
            title="术后"
            items={[
              ["monitor", "重点监测", "根据最终风险分层安排神经、心肺、血栓和肝功能相关监测。"],
              ["content_paste", "病历记录", "可使用复制按钮生成病历摘要，并结合正式评估表结果修订。"],
            ]}
          />
        </div>
      </section>
    </>
  );
}

function RiskCard({ result, featured }: { result: AssessmentResult; featured?: boolean }) {
  return (
    <article className={`riskCard ${result.level} ${featured ? "featured" : ""}`}>
      <div className="riskTop">
        <div>
          <span className="riskKicker">
            <Icon name={iconForResult(result.moduleId)} />
            {result.title}
          </span>
          <h3>{result.statusText}</h3>
        </div>
        <div className="scoreBox">
          <strong>{result.scoreLabel}</strong>
          <p>{result.configured ? "已配置" : "占位规则"}</p>
        </div>
      </div>
      <p>{result.summary}</p>
      <div className="tagRow">
        {(result.factors.length ? result.factors : ["待补充评估资料"]).slice(0, 4).map((factor) => <span key={factor}>{factor}</span>)}
      </div>
    </article>
  );
}

function ResultPanel({ result }: { result: AssessmentResult }) {
  return (
    <aside className="resultPanel">
      <p className="eyebrow">当前结果</p>
      <h3>{result.statusText}</h3>
      <strong>{result.scoreLabel}</strong>
      <p>{result.summary}</p>
      <div>
        <p className="miniTitle">建议</p>
        <ul>
          {result.recommendations.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </aside>
  );
}

function RecommendationColumn({ title, items }: { title: string; items: [string, string, string][] }) {
  return (
    <div className="recColumn">
      <h3>{title}</h3>
      {items.map(([icon, heading, body]) => (
        <div className="recItem" key={heading}>
          <Icon name={icon} />
          <div>
            <strong>{heading}</strong>
            <p>{body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="pageHeading">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function iconForResult(id: AssessmentId) {
  return assessmentModules.find((module) => module.id === id)?.icon ?? "description";
}

function buildReportText(patient: PatientProfile, results: AssessmentResult[]) {
  const lines = [
    "围术期器官功能评估摘要",
    `患者ID：${patient.patientId || "未填写"}`,
    `年龄/性别：${patient.age || "未填写"} / ${patient.sex || "未填写"}`,
    `拟行手术：${patient.surgeryName || "未填写"}`,
    "",
    "分系统评估：",
    ...results.map((result) => `${result.title}：${result.statusText}；${result.scoreLabel}；${result.summary}`),
    "",
    "说明：当前首版未导入正式评分表的模块均标记为待配置，不作为确定性医学结论。",
  ];
  return lines.join("\n");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
