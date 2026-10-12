'use client';

import { Project, projectStages, ProjectStage } from '../../data/mock';
import { Target, IndianRupee, HandCoins, AlertTriangle, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

interface ProjectOverviewProps {
  project: Project;
}

export default function ProjectOverview({ project }: ProjectOverviewProps) {
  const f = project.financials;

  const currentStageIdx = projectStages.indexOf(project.stage);

  return (
    <div className="space-y-6">
      
      {/* ── ALERTS ── */}
      {project.alerts && project.alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          {project.alerts.map((alert, i) => {
            const isWarning = alert.includes('⚠');
            return (
              <div key={i} className={`flex items-center gap-2 px-4 py-3 rounded-xl border ${
                isWarning ? 'bg-amber-400/5 border-amber-400/20 text-amber-400' : 'bg-green-400/5 border-green-400/20 text-green-400'
              }`}>
                {isWarning ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                <span className="text-[12px] font-semibold">{alert.replace('⚠ ', '').replace('✓ ', '')}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── LEFT COLUMN: Health & Progress ── */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Progress Stepper */}
          <div className="bg-[#151619] border border-[#292B30] rounded-xl p-6">
            <h3 className="text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-6">Project Lifecycle</h3>
            
            <div className="relative flex items-center justify-between">
              {/* Line background */}
              <div className="absolute left-0 right-0 top-3 h-px bg-[#292B30]" />
              
              {/* Active line */}
              <div 
                className="absolute left-0 top-3 h-px bg-yellow-400 transition-all duration-1000" 
                style={{ width: `${Math.max(0, (currentStageIdx / (projectStages.length - 1)) * 100)}%` }} 
              />

              {projectStages.map((stage, idx) => {
                const isDone = idx < currentStageIdx || project.status === 'Completed';
                const isCurrent = idx === currentStageIdx && project.status !== 'Completed';

                return (
                  <div key={stage} className="flex flex-col items-center relative z-10 w-16">
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center bg-[#151619] transition-all ${
                      isDone ? 'border-green-400' :
                      isCurrent ? 'border-yellow-400 shadow-[0_0_10px_rgba(255,196,0,0.3)]' :
                      'border-[#292B30]'
                    }`}>
                      {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                      {isCurrent && <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />}
                    </div>
                    <span className={`text-center text-[9px] font-bold uppercase tracking-wider mt-2 max-w-full break-words ${
                      isCurrent ? 'text-yellow-400' : isDone ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      {stage}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Key Information */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#151619] border border-[#292B30] rounded-xl p-5">
              <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-4">Project Information</h3>
              <div className="space-y-3">
                <InfoRow label="Project Type" value={project.type} />
                <InfoRow label="Property Type" value={project.propertyType} />
                <InfoRow label="Sales Executive" value={project.salesExecutive} />
                <InfoRow label="Priority" value={project.priority} valueColor={project.priority === 'High' || project.priority === 'Critical' ? 'text-red-400' : 'text-white'} />
              </div>
            </div>

            <div className="bg-[#151619] border border-[#292B30] rounded-xl p-5">
              <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-4">CRM References</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 font-semibold uppercase">Lead</span>
                  <Link href="/leads" className="text-[12px] font-mono text-blue-400 hover:underline flex items-center gap-1">
                    {project.crmRefs.leadId} <ArrowUpRight className="w-3 h-3" />
                  </Link>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 font-semibold uppercase">Deal</span>
                  <Link href="/deals" className="text-[12px] font-mono text-blue-400 hover:underline flex items-center gap-1">
                    {project.crmRefs.dealId} <ArrowUpRight className="w-3 h-3" />
                  </Link>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 font-semibold uppercase">Quote</span>
                  <Link href="/quotes" className="text-[12px] font-mono text-blue-400 hover:underline flex items-center gap-1">
                    {project.crmRefs.quoteId} <ArrowUpRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN: Financials & Health ── */}
        <div className="space-y-6">
          {/* Financial Summary */}
          <div className="bg-[#151619] border border-[#292B30] rounded-xl p-6 relative overflow-hidden">
            {/* Background glow */}
            <div className="absolute -top-10 -right-10 w-32 h-32 bg-yellow-400/5 rounded-full blur-3xl pointer-events-none" />
            
            <h3 className="text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-6 flex items-center gap-2">
              <IndianRupee className="w-4 h-4 text-gray-400" /> Project Financials
            </h3>

            <div className="space-y-5">
              <div className="bg-[#0D0D0F] border border-[#292B30] rounded-xl p-4 text-center">
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Project Value</div>
                <div className="text-[24px] font-black text-yellow-400">₹{f.contractValue.toLocaleString('en-IN')}</div>
                <div className="text-[10px] text-gray-600 mt-1">Gross Margin: {Math.round((f.expectedProfit / f.contractValue) * 100)}%</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Cost to Date</div>
                  <div className="text-[16px] font-bold text-white">₹{f.actualCost.toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Current Profit</div>
                  <div className={`text-[16px] font-bold ${f.currentProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ₹{f.currentProfit.toLocaleString('en-IN')}
                  </div>
                </div>
              </div>

              <div className="w-full h-px bg-[#292B30]" />

              <div>
                <div className="flex items-center justify-between text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  <span>Payments Received</span>
                  <span className="text-white">₹{f.receivedAmount.toLocaleString('en-IN')}</span>
                </div>
                <div className="w-full h-1.5 bg-[#0D0D0F] rounded-full overflow-hidden border border-[#292B30]">
                  <div 
                    className="h-full rounded-full bg-green-400 transition-all"
                    style={{ width: `${(f.receivedAmount / f.totalContractValue) * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-gray-500 mt-1.5">
                  <span>Pending: ₹{f.pendingAmount.toLocaleString('en-IN')}</span>
                  <span>Total w/ GST: ₹{f.totalContractValue.toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Project Health */}
          <div className="bg-[#151619] border border-[#292B30] rounded-xl p-5">
            <h3 className="text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center justify-between">
              Project Health
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                project.health.overall === 'ON TRACK' ? 'bg-green-400/10 text-green-400' :
                project.health.overall === 'AT RISK' ? 'bg-amber-400/10 text-amber-400' : 'bg-red-400/10 text-red-400'
              }`}>{project.health.overall}</span>
            </h3>

            <div className="space-y-3">
              <HealthBar label="Schedule" value={project.health.schedule} />
              <HealthBar label="Budget" value={project.health.budget} />
              <HealthBar label="Execution" value={project.health.execution} />
              <HealthBar label="Procurement" value={project.health.procurement} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, valueColor = 'text-white' }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-gray-500 font-semibold">{label}</span>
      <span className={`text-[12px] font-semibold ${valueColor}`}>{value}</span>
    </div>
  );
}

function HealthBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-gray-400 font-medium w-20">{label}</span>
      <div className="flex-1 h-1.5 bg-[#0D0D0F] rounded-full overflow-hidden border border-[#292B30]">
        <div 
          className={`h-full rounded-full transition-all ${
            value >= 80 ? 'bg-green-400' : value >= 60 ? 'bg-amber-400' : 'bg-red-400'
          }`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-[11px] font-bold text-white w-8 text-right">{value}%</span>
    </div>
  );
}
