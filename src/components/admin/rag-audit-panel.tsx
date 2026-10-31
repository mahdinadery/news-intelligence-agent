import Link from "next/link";
import type { RagAudit } from "@/lib/ai/rag-memory";

export function RagAuditPanel({audit}: {audit: RagAudit}) {
  return <div className="rounded-xl border border-line p-3 text-sm" dir="rtl">
    <h4 className="font-bold">حافظهٔ خبری RAG — آزمایشی</h4>
    <p>بازیابی: {({disabled:"خاموش",retrieved:"سابقه یافت شد",empty:"سابقهٔ کافی یافت نشد",unavailable:"آرشیو در دسترس نیست؛ تحلیل بدون حافظه"})[audit.status]}</p>
    {audit.assessment ? <><p>مقایسه: {({repeat:"بازنشر احتمالی",update:"تحول تازهٔ احتمالی",new:"جدید نسبت به سوابق بازیابی‌شده",uncertain:"نامشخص"})[audit.assessment.verdict]}</p><p>{audit.assessment.change}</p><p>ارجاعات: {audit.assessment.referenceIds.join("، ") || "ندارد"}</p></> : null}
    <ul className="mt-2 space-y-2">{audit.documents.map(doc => <li key={doc.id} className="rounded border border-line p-2">
      <Link className="underline" href={`/admin/news/${encodeURIComponent(doc.id)}`}>{doc.title}</Link>
      <p className="text-xs">{doc.source} · {doc.publishedAt ?? "تاریخ نامشخص"}</p><p className="text-xs break-all">{doc.url}</p><p>{doc.excerpt}</p>
    </li>)}</ul>
    <p className="mt-2 text-xs text-muted">این ارزیابی امتیازها یا تصمیم ارسال را مستقیماً تغییر نمی‌دهد. نبود سابقه، اثبات تازگی خبر نیست.</p>
  </div>;
}
