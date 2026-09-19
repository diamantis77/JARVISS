import type { Activity } from "@/types";
export function ActivityPanel({ activities }: { activities: Activity[] }) {
  return <section className="panel side"><p className="panel-title">Recent activity</p><div className="activity">{activities.map((item) => <div className="activity-row" key={item.id}><time>{item.time}</time><strong>{item.title}</strong><p>{item.description}</p></div>)}</div></section>;
}
