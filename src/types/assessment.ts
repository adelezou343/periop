export type AssessmentId = "clinical" | "stroke" | "cardiac" | "pulmonary" | "thrombosis" | "liver" | "summary";

export type FieldType = "text" | "number" | "textarea" | "select" | "checkbox";

export type RiskLevel = "pending" | "low" | "moderate" | "high";

export interface PatientProfile {
  patientId: string;
  age: string;
  sex: string;
  surgeryName: string;
  history: string;
  medications: string;
}

export interface AssessmentField {
  id: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  unit?: string;
  options?: string[];
}

export interface AssessmentResult {
  moduleId: AssessmentId;
  title: string;
  level: RiskLevel;
  statusText: string;
  scoreLabel: string;
  summary: string;
  factors: string[];
  recommendations: string[];
  configured: boolean;
}

export interface AssessmentModule {
  id: AssessmentId;
  title: string;
  shortTitle: string;
  icon: string;
  fields: AssessmentField[];
  evaluate: (inputs: Record<string, string | boolean>, patient: PatientProfile) => AssessmentResult;
}
