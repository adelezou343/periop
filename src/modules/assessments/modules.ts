import type { AssessmentModule, AssessmentResult, PatientProfile, RiskLevel } from "../../types/assessment";

const levelText: Record<RiskLevel, string> = {
  pending: "待配置",
  low: "低风险",
  moderate: "中等风险",
  high: "高风险",
};

function placeholderResult(
  moduleId: AssessmentResult["moduleId"],
  title: string,
  inputs: Record<string, string | boolean>,
  patient: PatientProfile,
): AssessmentResult {
  const factors = Object.entries(inputs)
    .filter(([, value]) => value === true || (typeof value === "string" && value.trim().length > 0))
    .map(([key]) => key);

  const patientReady = Boolean(patient.age || patient.surgeryName);

  return {
    moduleId,
    title,
    level: "pending",
    statusText: levelText.pending,
    scoreLabel: "评分规则待导入",
    summary: patientReady
      ? "已记录相关临床资料。当前模块尚未接入正式评估表，因此不生成确定性风险分层。"
      : "请先录入患者基本资料。当前模块尚未接入正式评估表。",
    factors,
    recommendations: [
      "导入正式评估表后，将自动生成评分、风险分层和围术期建议。",
      "在规则未确认前，请以临床指南和专科会诊意见为准。",
    ],
    configured: false,
  };
}

function isChecked(inputs: Record<string, string | boolean>, key: string) {
  return inputs[key] === true;
}

function numericAge(patient: PatientProfile) {
  const age = Number(patient.age);
  return Number.isFinite(age) ? age : undefined;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function evaluateStroke(inputs: Record<string, string | boolean>, patient: PatientProfile): AssessmentResult {
  const age = numericAge(patient);
  const ageScore = age === undefined ? 0 : age < 65 ? 0 : age <= 75 ? 1 : 2;
  const priorStroke = isChecked(inputs, "priorStroke");
  const priorMi = isChecked(inputs, "priorMi");
  const peripheralVascularDisease = isChecked(inputs, "peripheralVascularDisease");
  const vascularDisease = priorMi || peripheralVascularDisease;

  const esrsItems: Array<[string, number, boolean]> = [
    [age === undefined ? "年龄未填写" : age < 65 ? "年龄<65岁" : age <= 75 ? "年龄65-75岁" : "年龄>75岁", ageScore, age !== undefined],
    ["高血压", 1, isChecked(inputs, "hypertension")],
    ["糖尿病", 1, isChecked(inputs, "diabetes")],
    ["既往心肌梗死", 1, priorMi],
    ["其他心脏病", 1, isChecked(inputs, "otherHeartDisease")],
    ["周围血管病", 1, peripheralVascularDisease],
    ["吸烟", 1, isChecked(inputs, "smoking")],
    ["既往TIA或缺血性卒中病史", 1, priorStroke],
  ];

  const rawEsrsScore = esrsItems.reduce((total, [, score, active]) => total + (active ? score : 0), 0);
  const esrsScore = Math.max(rawEsrsScore, 2);
  const esrsStatus = esrsScore <= 2 ? "ESRS 中低危" : esrsScore <= 6 ? "ESRS 高度风险" : "ESRS 极高度风险";
  const esrsLevel: RiskLevel = esrsScore <= 2 ? "low" : "high";
  const esrsRiskText = esrsScore <= 2 ? "0-2分，中低危；截图表未标注年卒中复发风险。" : esrsScore <= 6 ? "3-6分，高度风险；年卒中复发风险约7%-9%。" : "6分以上，极高度风险；年卒中复发风险约11%。";

  const hasAf = isChecked(inputs, "atrialFibrillation");
  const chaItems: Array<[string, number, boolean]> = [
    ["心衰/左室功能不全", 1, isChecked(inputs, "heartFailure")],
    ["高血压", 1, isChecked(inputs, "hypertension")],
    ["年龄>=75岁", 2, age !== undefined && age >= 75],
    ["糖尿病", 1, isChecked(inputs, "diabetes")],
    ["卒中/TIA/血栓栓塞史", 2, priorStroke],
    ["血管疾病", 1, vascularDisease],
    ["年龄65-74岁", 1, age !== undefined && age >= 65 && age < 75],
    ["女性", 1, patient.sex === "女"],
  ];
  const chaScore = hasAf ? chaItems.reduce((total, [, score, active]) => total + (active ? score : 0), 0) : undefined;
  const chaRiskText = hasAf ? `房颤患者 CHA2DS2-VASc 评分 ${chaScore} 分。` : "未勾选房颤，CHA2DS2-VASc 评分不启用。";

  const factors = [
    ...esrsItems.filter(([, , active]) => active).map(([label, score]) => `${label} +${score}`),
    ...(hasAf ? ["房颤"] : []),
    ...(hasAf ? chaItems.filter(([, , active]) => active).map(([label, score]) => `CHA ${label} +${score}`) : []),
  ];

  const recommendations = [
    `ESRS：${esrsRiskText}`,
    rawEsrsScore < 2 ? "ESRS最低按2分提交；未勾选危险因素时，最终报告分数仍记为2分。" : "ESRS按已勾选危险因素累计计分。",
    chaRiskText,
  ];

  const lastEventDate = typeof inputs.lastStrokeOrTiaDate === "string" ? inputs.lastStrokeOrTiaDate : "";
  if (priorStroke) {
    recommendations.push("手术时机建议：对于既往有卒中或TIA史的患者，建议将择期非心脏手术延迟至最近一次事件发生的3个月后，以降低复发性卒中或主要不良心血管事件（MACE）的发生率。");
    if (lastEventDate) {
      const eventDate = new Date(`${lastEventDate}T00:00:00`);
      if (!Number.isNaN(eventDate.getTime())) {
        const earliestDate = addMonths(eventDate, 3);
        recommendations.push(`最近一次卒中/TIA日期：${lastEventDate}；建议择期非心脏手术日期不早于 ${formatDate(earliestDate)}。`);
      }
    }
  }

  return {
    moduleId: "stroke",
    title: "卒中风险评估",
    level: esrsLevel,
    statusText: esrsStatus,
    scoreLabel: hasAf ? `ESRS ${esrsScore}分；CHA2DS2-VASc ${chaScore}分` : `ESRS ${esrsScore}分`,
    summary: `${esrsRiskText} ${chaRiskText}`,
    factors,
    recommendations,
    configured: true,
  };
}

function numberInput(inputs: Record<string, string | boolean>, key: string) {
  const value = inputs[key];
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function classifyByRanges(value: number | undefined, low: (value: number) => boolean, moderate: (value: number) => boolean, high: (value: number) => boolean) {
  if (value === undefined) {
    return undefined;
  }
  if (high(value)) {
    return "high" as RiskLevel;
  }
  if (moderate(value)) {
    return "moderate" as RiskLevel;
  }
  if (low(value)) {
    return "low" as RiskLevel;
  }
  return undefined;
}

function maxRisk(levels: Array<RiskLevel | undefined>): RiskLevel {
  if (levels.includes("high")) {
    return "high";
  }
  if (levels.includes("moderate")) {
    return "moderate";
  }
  if (levels.includes("low")) {
    return "low";
  }
  return "pending";
}

function evaluatePulmonary(inputs: Record<string, string | boolean>, patient: PatientProfile): AssessmentResult {
  const age = numericAge(patient);
  const surgeryType = typeof inputs.surgeryType === "string" ? inputs.surgeryType : "未选择";
  const surgeryTypeScores: Record<string, number> = {
    腹主动脉瘤手术: 27,
    胸科手术: 21,
    "神经外科/上腹部/外周血管手术": 14,
    颈部手术: 11,
    其他: 0,
    未选择: 0,
  };

  const albumin = numberInput(inputs, "albumin");
  const bun = numberInput(inputs, "bun");
  const duration = numberInput(inputs, "duration");

  const arozullahItems: Array<[string, number, boolean]> = [
    [`手术类型：${surgeryType}`, surgeryTypeScores[surgeryType] ?? 0, surgeryType !== "未选择" && surgeryType !== "其他"],
    ["急诊手术", 11, isChecked(inputs, "emergencySurgery")],
    ["白蛋白<30 g/L", 9, albumin !== undefined && albumin < 30],
    ["尿素氮>0.3 g/L（10.68 umol/L）", 8, bun !== undefined && bun > 0.3],
    ["部分或完全依赖性功能状态", 7, isChecked(inputs, "dependentFunctionalStatus")],
    ["COPD病史", 6, isChecked(inputs, "copd")],
    ["年龄>70岁", 6, age !== undefined && age > 70],
    ["年龄60-69岁", 4, age !== undefined && age >= 60 && age <= 69],
    ["手术时间>180 min", 10, duration !== undefined && duration > 180],
  ];

  const arozullahScore = arozullahItems.reduce((total, [, score, active]) => total + (active ? score : 0), 0);
  const arozullahLevel: RiskLevel = arozullahScore <= 10 ? "low" : arozullahScore <= 19 ? "moderate" : "high";
  const arozullahRiskText =
    arozullahScore <= 10
      ? "Arozullah评分≤10分，术后急性呼吸衰竭发生率约0.5%。"
      : arozullahScore <= 19
        ? "Arozullah评分11-19分，术后急性呼吸衰竭发生率约1.8%。"
        : arozullahScore <= 27
          ? "Arozullah评分20-27分，术后急性呼吸衰竭发生率约4.2%。"
          : arozullahScore <= 40
            ? "Arozullah评分28-40分，术后急性呼吸衰竭发生率约10.1%。"
            : "Arozullah评分>40分，术后急性呼吸衰竭发生率约26.6%。";

  const preopSpo2 = numberInput(inputs, "preopSpo2");
  const pftContext = typeof inputs.pftContext === "string" ? inputs.pftContext : "未选择";
  const fev1 = numberInput(inputs, "fev1");
  const fev1Percent = numberInput(inputs, "fev1Percent");

  const oxygenLevel: RiskLevel = preopSpo2 === undefined ? "pending" : preopSpo2 < 90 ? "high" : "low";
  const oxygenStatus = oxygenLevel === "pending" ? "术前血氧饱和度未输入" : oxygenLevel === "high" ? "术前血氧饱和度<90%" : "术前血氧饱和度≥90%";
  let pftLevel: RiskLevel = "pending";
  let pftStatus = "肺功能未评估";
  const pftMissing: string[] = [];
  const pftFactors: string[] = [];

  if (pftContext === "非胸部手术") {
    if (fev1Percent === undefined) {
      pftMissing.push("FEV1%预计值");
      pftStatus = "非胸部手术肺功能资料不完整";
    } else if (fev1Percent > 60) {
      pftLevel = "low";
      pftStatus = "非胸部手术肺功能筛选通过";
      pftFactors.push(`FEV1%预计值 ${fev1Percent}% >60%`);
    } else {
      pftLevel = "high";
      pftStatus = "非胸部手术肺功能并发症风险增加";
      pftFactors.push(`FEV1%预计值 ${fev1Percent}% ≤60%`);
    }
  } else if (pftContext === "全肺切除术") {
    if (fev1 === undefined) {
      pftMissing.push("FEV1(L)");
      pftStatus = "全肺切除术肺功能资料不完整";
    } else if (fev1 > 2) {
      pftLevel = "low";
      pftStatus = "FEV1支持全肺切除术";
      pftFactors.push(`FEV1 ${fev1}L >2.0L`);
    } else {
      pftLevel = "high";
      pftStatus = "FEV1未达传统全肺切除阈值";
      pftFactors.push(`FEV1 ${fev1}L ≤2.0L`);
    }
  } else if (pftContext === "肺叶切除术") {
    if (fev1 === undefined) {
      pftMissing.push("FEV1(L)");
      pftStatus = "肺叶切除术肺功能资料不完整";
    } else if (fev1 > 1.5) {
      pftLevel = "low";
      pftStatus = "FEV1支持肺叶切除术";
      pftFactors.push(`FEV1 ${fev1}L >1.5L`);
    } else {
      pftLevel = "high";
      pftStatus = "FEV1未达传统肺叶切除阈值";
      pftFactors.push(`FEV1 ${fev1}L ≤1.5L`);
    }
  } else {
    pftMissing.push("肺功能适用场景");
  }

  const displayLevel = maxRisk([arozullahLevel, oxygenLevel, pftLevel]);
  const arozullahStatus = arozullahLevel === "high" ? "Arozullah 高风险" : arozullahLevel === "moderate" ? "Arozullah 中等风险" : "Arozullah 低风险";

  const oxygenFactors = preopSpo2 === undefined ? [] : [`术前SpO2 ${preopSpo2}%${preopSpo2 < 90 ? "：增加术后并发症风险" : "：未提示<90%风险"}`];
  const activeArozullahFactors = arozullahItems.filter(([, , active]) => active).map(([label, score]) => `${label} +${score}`);
  const oxygenSummary = preopSpo2 === undefined
    ? "未输入术前血氧饱和度；缺少：术前SpO2。"
    : preopSpo2 < 90
      ? `术前SpO2 ${preopSpo2}%，<90%，会增加术后并发症风险。`
      : `术前SpO2 ${preopSpo2}%，未低于90%。`;
  const pftSummary = pftFactors.length
    ? `${pftStatus}；${pftFactors.join("、")}；缺少：${pftMissing.length ? pftMissing.join("、") : "无"}。`
    : `${pftStatus}；缺少：${pftMissing.join("、")}。`;
  const highWarningItems = [
    ...(oxygenLevel === "high" ? ["术前SpO2<90%"] : []),
    ...(pftLevel === "high" ? pftFactors : []),
  ];

  return {
    moduleId: "pulmonary",
    title: "肺部评估",
    level: displayLevel,
    statusText: `${arozullahStatus}；${oxygenStatus}；${pftStatus}`,
    scoreLabel: `Arozullah ${arozullahScore}分`,
    summary: `${arozullahRiskText} ${oxygenSummary} ${pftSummary}`,
    factors: [...activeArozullahFactors, ...oxygenFactors, ...pftFactors],
    recommendations: [
      `Arozullah风险：${arozullahRiskText}`,
      `术前血氧饱和度：${oxygenSummary}`,
      `肺功能：${pftSummary}`,
      "Arozullah评分、术前血氧饱和度和肺功能反映的临床意义不同，报告中分开呈现。",
      "不再要求血气分析；术前血氧饱和度<90%提示术后并发症风险增加。肺功能仅对已输入的信息按对应手术类型判断，并备注缺少的指标。",
      ...(highWarningItems.length ? ["提示存在术后通气不足或咳痰困难风险，易发生术后坠积性肺炎、肺不张，并可能出现呼吸衰竭。"] : []),
      "进行上腹部或开胸手术并发症危险性较大，肺部手术危险性更大。",
    ],
    configured: true,
  };
}

function evaluateCardiac(inputs: Record<string, string | boolean>, patient: PatientProfile): AssessmentResult {
  const surgicalCardiacRisk = typeof inputs.surgicalCardiacRisk === "string" ? inputs.surgicalCardiacRisk : "未选择";
  const rcriItems: Array<[string, boolean]> = [
    ["高危手术", isChecked(inputs, "highRiskSurgery")],
    ["缺血性心脏病史", isChecked(inputs, "ischemicHeartDisease")],
    ["充血性心力衰竭病史", isChecked(inputs, "heartFailure")],
    ["脑血管疾病病史", isChecked(inputs, "cerebrovascularDisease")],
    ["术前正在接受胰岛素治疗", isChecked(inputs, "insulinTherapy")],
    ["术前血肌酐>2 mg/dL（176.8 umol/L）", isChecked(inputs, "creatinineOver2")],
  ];
  const rcriScore = rcriItems.filter(([, active]) => active).length;
  const rcriClass = rcriScore === 0 ? "1级" : rcriScore === 1 ? "2级" : rcriScore === 2 ? "3级" : "4级";
  const maceRisk = rcriScore === 0 ? 0.4 : rcriScore === 1 ? 0.9 : rcriScore === 2 ? 6.6 : 11;
  const calculatedRiskElevated = rcriScore > 1 || maceRisk > 1;

  const modifierItems: Array<[string, boolean]> = [
    ["严重心脏瓣膜病", isChecked(inputs, "severeValveDisease")],
    ["严重肺动脉高压", isChecked(inputs, "severePulmonaryHypertension")],
    ["高风险先天性心脏病", isChecked(inputs, "highRiskCongenitalHeartDisease")],
    ["既往冠脉支架/搭桥史", isChecked(inputs, "priorPciOrCabg")],
    ["近期中风", isChecked(inputs, "recentStroke")],
    ["植入心血管电子设备", isChecked(inputs, "cardiacImplantableDevice")],
    ["衰弱状态", isChecked(inputs, "frailty")],
  ];
  const activeModifiers = modifierItems.filter(([, active]) => active).map(([label]) => label);
  const hasModifiers = activeModifiers.length > 0;

  const functionalCapacity = typeof inputs.functionalCapacity === "string" ? inputs.functionalCapacity : "未知";
  const bnpStatus = typeof inputs.bnpStatus === "string" ? inputs.bnpStatus : "未检测";
  const troponinStatus = typeof inputs.troponinStatus === "string" ? inputs.troponinStatus : "未检测";
  const biomarkersKnown = bnpStatus !== "未检测" || troponinStatus !== "未检测";
  const biomarkersAbnormal = bnpStatus === "异常" || troponinStatus === "异常";
  const biomarkersNormal = biomarkersKnown && !biomarkersAbnormal && bnpStatus !== "未检测" && troponinStatus !== "未检测";

  const recommendations: string[] = [
    `手术本身心血管风险：${surgicalCardiacRisk}。`,
    `RCRI：${rcriScore}分，${rcriClass}，MACE发生风险约${maceRisk}%。`,
  ];

  let pathway = "";
  let statusText = "";
  if (!calculatedRiskElevated && !hasModifiers) {
    pathway = "计算风险低且无风险调节因素：可直接进行手术。";
    statusText = "心脏低风险：可直接手术";
  } else if (hasModifiers) {
    pathway = "存在风险调节因素：建议心脏彩超；无论RCRI计算风险高低均应优先处理该路径。";
    statusText = "存在风险调节因素";
    recommendations.push("建议心脏彩超，结合瓣膜病、肺动脉高压、先心病、既往PCI/CABG、近期中风、心血管电子设备或衰弱状态进一步评估。");
  } else if (functionalCapacity === ">=4 METs") {
    pathway = "计算风险升高但无风险调节因素，功能状态良好（METs≥4）：可直接手术。";
    statusText = "RCRI风险升高，功能状态良好";
  } else if (functionalCapacity === "<4 METs" || functionalCapacity === "未知") {
    if (biomarkersAbnormal) {
      pathway = "功能状态较差或未知，且BNP/肌钙蛋白异常：考虑冠脉CTA。";
      statusText = "生物标志物异常";
      recommendations.push("针对生物标志物异常者，考虑冠脉CTA。");
    } else if (biomarkersNormal) {
      pathway = "功能状态较差或未知，但BNP和肌钙蛋白正常：可直接手术。";
      statusText = "功能状态较差/未知，标志物正常";
    } else {
      pathway = "功能状态较差或未知：建议检测BNP和肌钙蛋白。";
      statusText = "需检测BNP和肌钙蛋白";
      recommendations.push("建议测BNP和肌钙蛋白；若结果正常可直接手术，异常者考虑冠脉CTA。");
    }
  }

  if (isChecked(inputs, "recentCoronaryStent")) {
    recommendations.push("接受冠脉支架置入的患者，建议将非心脏手术延迟至术后6个月。");
  }

  recommendations.push(pathway);

  const level: RiskLevel = hasModifiers || biomarkersAbnormal ? "high" : calculatedRiskElevated ? "moderate" : "low";
  const activeRcriFactors = rcriItems.filter(([, active]) => active).map(([label]) => label);

  return {
    moduleId: "cardiac",
    title: "心脏评估",
    level,
    statusText,
    scoreLabel: `RCRI ${rcriScore}分；MACE ${maceRisk}%`,
    summary: `手术本身心血管风险：${surgicalCardiacRisk}。RCRI ${rcriClass}，MACE约${maceRisk}%。${pathway}`,
    factors: [`手术风险：${surgicalCardiacRisk}`, ...activeRcriFactors, ...activeModifiers],
    recommendations,
    configured: true,
  };
}

function selectedScore(inputs: Record<string, string | boolean>, key: string, scores: Record<string, number>) {
  const value = inputs[key];
  if (typeof value !== "string") {
    return 0;
  }
  return scores[value] ?? 0;
}

function selectedLabel(inputs: Record<string, string | boolean>, key: string) {
  const value = inputs[key];
  return typeof value === "string" && value !== "无" ? value : undefined;
}

function evaluateThrombosis(inputs: Record<string, string | boolean>, patient: PatientProfile): AssessmentResult {
  const groupedItems: Array<[string, number, string | undefined]> = [
    ["年龄", selectedScore(inputs, "ageGroup", { "≤40岁": 0, "41-60岁": 1, "61-74岁": 2, "≥75岁": 3 }), selectedLabel(inputs, "ageGroup")],
    ["活动", selectedScore(inputs, "mobility", { 无: 0, "限制活动<72h": 1, "限制活动≥72h": 2 }), selectedLabel(inputs, "mobility")],
    ["留置中心静脉导管", selectedScore(inputs, "centralVenousCatheter", { 无: 0, "中心静脉置管（PICC或CVC）": 2 }), selectedLabel(inputs, "centralVenousCatheter")],
    ["手术相关因素", selectedScore(inputs, "operationDuration", { 无: 0, "手术<45min": 1, "手术≥45min": 2 }), selectedLabel(inputs, "operationDuration")],
  ];

  const additiveItems: Array<[string, number, boolean]> = [
    ["脑卒中（1个月内）", 5, isChecked(inputs, "recentStroke")],
    ["VTE病史", 3, isChecked(inputs, "priorVte")],
    ["VTE家族史", 3, isChecked(inputs, "familyVte")],
    ["肝素诱导的血小板减少症", 3, isChecked(inputs, "hit")],
    ["其他先天性或获得性血栓形成倾向", 3, isChecked(inputs, "thrombophilia")],
    ["恶性肿瘤", 2, isChecked(inputs, "malignancy")],
    ["炎症性肠病", 1, isChecked(inputs, "ibd")],
    ["下肢水肿", 1, isChecked(inputs, "legEdema")],
    ["静脉曲张", 1, isChecked(inputs, "varicoseVeins")],
    ["严重肺部疾病（1个月内）", 1, isChecked(inputs, "recentSevereLungDisease")],
    ["肺功能异常", 1, isChecked(inputs, "abnormalPulmonaryFunction")],
    ["急性心肌梗塞", 1, isChecked(inputs, "acuteMi")],
    ["充血性心力衰竭（1个月内）", 1, isChecked(inputs, "recentChf")],
    ["败血症（1个月内）", 1, isChecked(inputs, "recentSepsis")],
    ["急性脊髓损伤（1个月内）", 5, isChecked(inputs, "acuteSpinalCordInjury")],
    ["择期关节置换术", 5, isChecked(inputs, "electiveArthroplasty")],
    ["髋关节、骨盆或下肢骨折", 5, isChecked(inputs, "hipPelvisLegFracture")],
    ["石膏固定", 2, isChecked(inputs, "castImmobilization")],
    ["血清同型半胱氨酸升高", 3, isChecked(inputs, "hyperhomocysteinemia")],
    ["狼疮抗凝物阳性", 3, isChecked(inputs, "lupusAnticoagulant")],
    ["抗心磷脂抗体阳性", 3, isChecked(inputs, "anticardiolipin")],
    ["凝血酶原G20210A突变", 3, isChecked(inputs, "prothrombinMutation")],
    ["凝血因子V Leiden突变", 3, isChecked(inputs, "factorVLeiden")],
    ["口服避孕药或激素替代治疗", 1, isChecked(inputs, "hormoneTherapy")],
    ["妊娠期或产后（1个月）", 1, isChecked(inputs, "pregnancyPostpartum")],
    ["不能解释或二次自然流产病史", 1, isChecked(inputs, "recurrentPregnancyLoss")],
  ];

  const groupScore = groupedItems.reduce((total, [, score]) => total + score, 0);
  const additiveScore = additiveItems.reduce((total, [, score, active]) => total + (active ? score : 0), 0);
  const score = groupScore + additiveScore;
  const level: RiskLevel = score >= 5 ? "high" : score >= 3 ? "moderate" : "low";
  const statusText = score >= 5 ? "Caprini 高危" : score >= 3 ? "Caprini 中危" : "Caprini 低危";
  const factors = [
    ...groupedItems.filter(([, score]) => score > 0).map(([group, score, label]) => `${group}：${label} +${score}`),
    ...additiveItems.filter(([, , active]) => active).map(([label, score]) => `${label} +${score}`),
  ];

  return {
    moduleId: "thrombosis",
    title: "血栓风险评估",
    level,
    statusText,
    scoreLabel: `Caprini ${score}分`,
    summary: `Caprini评分${score}分；低危0-2分，中危3-4分，高危≥5分。当前为${statusText}。`,
    factors,
    recommendations: [
      `Caprini评分：${score}分，${statusText}。`,
      "危险分级：低危0-2分；中危3-4分；高危≥5分。",
      "年龄、活动、留置中心静脉导管、手术相关因素按各组只选其一；内科、外科、辅助检查、女性患者相关因素按表格可累加。",
    ],
    configured: true,
  };
}

function evaluateLiver(inputs: Record<string, string | boolean>, patient: PatientProfile): AssessmentResult {
  const encephalopathy = typeof inputs.encephalopathy === "string" ? inputs.encephalopathy : "无";
  const ascites = typeof inputs.ascites === "string" ? inputs.ascites : "无";
  const bilirubin = numberInput(inputs, "bilirubin");
  const albumin = numberInput(inputs, "albumin");
  const ptProlongation = numberInput(inputs, "ptProlongation");

  const encephalopathyScore = encephalopathy === "3-4级" ? 3 : encephalopathy === "1-2级" ? 2 : 1;
  const ascitesScore = ascites === "中、重度" ? 3 : ascites === "轻度" ? 2 : 1;
  const bilirubinScore = bilirubin === undefined ? 0 : bilirubin < 34 ? 1 : bilirubin <= 51 ? 2 : 3;
  const albuminScore = albumin === undefined ? 0 : albumin > 35 ? 1 : albumin >= 28 ? 2 : 3;
  const ptScore = ptProlongation === undefined ? 0 : ptProlongation < 4 ? 1 : ptProlongation <= 6 ? 2 : 3;

  const scoredItems: Array<[string, number, boolean]> = [
    [`肝性脑病：${encephalopathy}`, encephalopathyScore, true],
    [`腹水：${ascites}`, ascitesScore, true],
    [`总胆红素：${bilirubin ?? "未输入"} umol/L`, bilirubinScore, bilirubin !== undefined],
    [`白蛋白：${albumin ?? "未输入"} g/L`, albuminScore, albumin !== undefined],
    [`凝血酶原时间延长：${ptProlongation ?? "未输入"} s`, ptScore, ptProlongation !== undefined],
  ];
  const missingItems = scoredItems.filter(([, , available]) => !available).map(([label]) => label.split("：")[0]);
  const score = scoredItems.reduce((total, [, itemScore]) => total + itemScore, 0);

  let childPughClass = "无法分级";
  let prognosis = "请补充总胆红素、白蛋白和凝血酶原时间延长后再分级。";
  let level: RiskLevel = "pending";
  if (missingItems.length === 0) {
    if (score <= 6) {
      childPughClass = "A级";
      prognosis = "手术风险小";
      level = "low";
    } else if (score <= 9) {
      childPughClass = "B级";
      prognosis = "手术风险中等";
      level = "moderate";
    } else {
      childPughClass = "C级";
      prognosis = "手术风险大";
      level = "high";
    }
  }

  return {
    moduleId: "liver",
    title: "肝脏评估（肝硬化）",
    level,
    statusText: missingItems.length === 0 ? `Child-Pugh ${childPughClass}` : "Child-Pugh 待补充",
    scoreLabel: missingItems.length === 0 ? `${score}分；${prognosis}` : "资料不完整",
    summary: missingItems.length === 0
      ? `Child-Pugh评分${score}分，${childPughClass}，${prognosis}。`
      : `已记录部分肝硬化评估资料，但缺少：${missingItems.join("、")}。`,
    factors: scoredItems.filter(([, , available]) => available).map(([label, itemScore]) => `${label} +${itemScore}`),
    recommendations: [
      "本模块适用于肝硬化患者的围术期肝脏风险评估。",
      missingItems.length === 0 ? `Child-Pugh分级：${childPughClass}，${prognosis}。` : `请补充：${missingItems.join("、")}。`,
      "Child-Pugh A级5-6分：手术风险小；B级7-9分：手术风险中等；C级10-15分：手术风险大。",
    ],
    configured: true,
  };
}

export const assessmentModules: AssessmentModule[] = [
  {
    id: "stroke",
    title: "卒中风险评估",
    shortTitle: "卒中",
    icon: "psychology",
    fields: [
      { id: "hypertension", label: "高血压", type: "checkbox" },
      { id: "diabetes", label: "糖尿病", type: "checkbox" },
      { id: "priorMi", label: "既往心肌梗死", type: "checkbox" },
      { id: "otherHeartDisease", label: "其他心脏病", type: "checkbox" },
      { id: "peripheralVascularDisease", label: "周围血管病", type: "checkbox" },
      { id: "smoking", label: "吸烟", type: "checkbox" },
      { id: "priorStroke", label: "既往TIA或缺血性卒中病史", type: "checkbox" },
      { id: "lastStrokeOrTiaDate", label: "最近一次卒中/TIA日期", type: "text", placeholder: "YYYY-MM-DD，用于择期手术时机建议" },
      { id: "atrialFibrillation", label: "房颤", type: "checkbox" },
      { id: "heartFailure", label: "心衰/左室功能不全（CHA2DS2-VASc）", type: "checkbox" },
      { id: "antiplatelet", label: "抗血小板/抗凝治疗", type: "text", placeholder: "如阿司匹林、氯吡格雷、华法林等" },
      { id: "notes", label: "神经系统补充资料", type: "textarea", placeholder: "记录近期症状、影像、会诊意见等" },
    ],
    evaluate: evaluateStroke,
  },
  {
    id: "cardiac",
    title: "心脏评估",
    shortTitle: "心脏",
    icon: "monitor_heart",
    fields: [
      { id: "surgicalCardiacRisk", label: "手术本身心血管风险", type: "select", options: ["未选择", "低风险（<1%）", "中等风险（1%-5%）", "高风险（>5%）"] },
      { id: "highRiskSurgery", label: "高危手术（胸腔内、腹腔内和腹股沟以上血管手术）", type: "checkbox" },
      { id: "ischemicHeartDisease", label: "缺血性心脏病", type: "checkbox" },
      { id: "heartFailure", label: "充血性心力衰竭病史", type: "checkbox" },
      { id: "cerebrovascularDisease", label: "脑血管疾病病史", type: "checkbox" },
      { id: "insulinTherapy", label: "术前正在接受胰岛素治疗", type: "checkbox" },
      { id: "creatinineOver2", label: "术前血肌酐>2 mg/dL（176.8 umol/L）", type: "checkbox" },
      { id: "severeValveDisease", label: "严重心脏瓣膜病", type: "checkbox" },
      { id: "severePulmonaryHypertension", label: "严重肺动脉高压", type: "checkbox" },
      { id: "highRiskCongenitalHeartDisease", label: "高风险先天性心脏病", type: "checkbox" },
      { id: "priorPciOrCabg", label: "既往冠脉支架/搭桥史", type: "checkbox" },
      { id: "recentCoronaryStent", label: "近期冠脉支架置入", type: "checkbox" },
      { id: "recentStroke", label: "近期中风", type: "checkbox" },
      { id: "cardiacImplantableDevice", label: "植入心血管电子设备（如起搏器）", type: "checkbox" },
      { id: "frailty", label: "衰弱（Frailty）状态", type: "checkbox" },
      { id: "functionalCapacity", label: "功能状态", type: "select", options: ["未知", "<4 METs", ">=4 METs"] },
      { id: "bnpStatus", label: "BNP/NT-proBNP", type: "select", options: ["未检测", "正常", "异常"] },
      { id: "troponinStatus", label: "肌钙蛋白", type: "select", options: ["未检测", "正常", "异常"] },
      { id: "ecg", label: "心电图/超声/CTA补充资料", type: "textarea", placeholder: "记录EF、瓣膜病、心律失常、CTA、会诊意见等" },
    ],
    evaluate: evaluateCardiac,
  },
  {
    id: "pulmonary",
    title: "肺部评估",
    shortTitle: "肺部",
    icon: "air",
    fields: [
      { id: "surgeryType", label: "手术类型（Arozullah）", type: "select", options: ["未选择", "腹主动脉瘤手术", "胸科手术", "神经外科/上腹部/外周血管手术", "颈部手术", "其他"] },
      { id: "emergencySurgery", label: "急诊手术", type: "checkbox" },
      { id: "albumin", label: "白蛋白", type: "number", unit: "g/L" },
      { id: "bun", label: "尿素氮", type: "number", unit: "g/L" },
      { id: "dependentFunctionalStatus", label: "部分或完全依赖性功能状态", type: "checkbox" },
      { id: "copd", label: "COPD/哮喘/限制性通气障碍", type: "checkbox" },
      { id: "duration", label: "预计手术时间", type: "number", unit: "min" },
      { id: "preopSpo2", label: "术前血氧饱和度SpO2", type: "number", unit: "%" },
      { id: "pftContext", label: "肺功能适用场景", type: "select", options: ["未选择", "非胸部手术", "全肺切除术", "肺叶切除术"] },
      { id: "fev1", label: "FEV1", type: "number", unit: "L" },
      { id: "fev1Percent", label: "FEV1%预计值", type: "number", unit: "%" },
      { id: "pft", label: "肺功能/影像补充资料", type: "textarea", placeholder: "可记录未结构化的肺功能、胸片/CT结论等" },
    ],
    evaluate: evaluatePulmonary,
  },
  {
    id: "thrombosis",
    title: "血栓风险评估",
    shortTitle: "血栓",
    icon: "bloodtype",
    fields: [
      { id: "ageGroup", label: "年龄（只选其一）", type: "select", options: ["≤40岁", "41-60岁", "61-74岁", "≥75岁"] },
      { id: "mobility", label: "活动（只选其一）", type: "select", options: ["无", "限制活动<72h", "限制活动≥72h"] },
      { id: "recentStroke", label: "脑卒中（1个月内）", type: "checkbox" },
      { id: "priorVte", label: "VTE病史", type: "checkbox" },
      { id: "familyVte", label: "VTE家族史", type: "checkbox" },
      { id: "hit", label: "肝素诱导的血小板减少症", type: "checkbox" },
      { id: "thrombophilia", label: "其他先天性或获得性血栓形成倾向", type: "checkbox" },
      { id: "malignancy", label: "恶性肿瘤", type: "checkbox" },
      { id: "ibd", label: "炎症性肠病", type: "checkbox" },
      { id: "legEdema", label: "下肢水肿", type: "checkbox" },
      { id: "varicoseVeins", label: "静脉曲张", type: "checkbox" },
      { id: "recentSevereLungDisease", label: "严重肺部疾病（1个月内）", type: "checkbox" },
      { id: "abnormalPulmonaryFunction", label: "肺功能异常", type: "checkbox" },
      { id: "acuteMi", label: "急性心肌梗塞", type: "checkbox" },
      { id: "recentChf", label: "充血性心力衰竭（1个月内）", type: "checkbox" },
      { id: "recentSepsis", label: "败血症（1个月内）", type: "checkbox" },
      { id: "acuteSpinalCordInjury", label: "急性脊髓损伤（1个月内）", type: "checkbox" },
      { id: "electiveArthroplasty", label: "择期关节置换术", type: "checkbox" },
      { id: "hipPelvisLegFracture", label: "髋关节、骨盆或下肢骨折", type: "checkbox" },
      { id: "castImmobilization", label: "石膏固定", type: "checkbox" },
      { id: "centralVenousCatheter", label: "留置中心静脉导管（只选其一）", type: "select", options: ["无", "中心静脉置管（PICC或CVC）"] },
      { id: "hyperhomocysteinemia", label: "血清同型半胱氨酸升高", type: "checkbox" },
      { id: "lupusAnticoagulant", label: "狼疮抗凝物阳性", type: "checkbox" },
      { id: "anticardiolipin", label: "抗心磷脂抗体阳性", type: "checkbox" },
      { id: "prothrombinMutation", label: "凝血酶原G20210A突变", type: "checkbox" },
      { id: "factorVLeiden", label: "凝血因子V Leiden突变", type: "checkbox" },
      { id: "hormoneTherapy", label: "口服避孕药或激素替代治疗", type: "checkbox" },
      { id: "pregnancyPostpartum", label: "妊娠期或产后（1个月）", type: "checkbox" },
      { id: "recurrentPregnancyLoss", label: "不能解释或二次自然流产病史", type: "checkbox" },
      { id: "operationDuration", label: "手术相关因素（只选其一）", type: "select", options: ["无", "手术<45min", "手术≥45min"] },
    ],
    evaluate: evaluateThrombosis,
  },
  {
    id: "liver",
    title: "肝脏评估（肝硬化）",
    shortTitle: "肝脏",
    icon: "medical_services",
    fields: [
      { id: "cirrhosisCause", label: "肝硬化病因", type: "text", placeholder: "乙肝、酒精、NASH等" },
      { id: "encephalopathy", label: "肝性脑病（级）", type: "select", options: ["无", "1-2级", "3-4级"] },
      { id: "ascites", label: "腹水", type: "select", options: ["无", "轻度", "中、重度"] },
      { id: "albumin", label: "白蛋白", type: "number", unit: "g/L" },
      { id: "bilirubin", label: "胆红素", type: "number", unit: "umol/L" },
      { id: "ptProlongation", label: "凝血酶原时间延长", type: "number", unit: "s" },
    ],
    evaluate: evaluateLiver,
  },
];
