export interface TaintFlow {
  sink: string;
  line: number;
  sources: string[];
  kind: 'unconditional-sink' | 'taint-flow';
}
export interface TaintAnalysisResult {
  schema: 'ultron.taint-ir.v1';
  isSafe: boolean;
  status: 'findings' | 'unknown' | 'no-known-flow' | 'parse-error';
  violations: string[];
  flows: TaintFlow[];
  ir: {
    edges: { from: string; to: string; line: number }[];
    callGraph: { caller: string; callee: string; line: number }[];
  };
  unknowns: string[];
  coverage: { parsed: boolean; visitedNodes: number; language: string; scope: string };
}
export declare const TAINT_IR_VERSION: 'ultron.taint-ir.v1';
export declare function analyzePayloadAST(codeSnippet: string): TaintAnalysisResult;
