function Bone({ className = '' }) {
  return <div className={`skeleton ${className}`} style={{ minHeight: 16 }} />;
}

function CardSkeleton() {
  return (
    <div className="card animate-pulse space-y-3">
      <Bone className="h-5 w-1/3" />
      <Bone className="h-4 w-full" />
      <Bone className="h-4 w-4/5" />
      <Bone className="h-10 w-1/2 mt-4" />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-4 lg:p-0">
      <div className="card animate-pulse">
        <Bone className="h-6 w-48 mb-2" />
        <Bone className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card animate-pulse space-y-2">
            <Bone className="h-8 w-8 rounded-xl" />
            <Bone className="h-6 w-16" />
            <Bone className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 rounded-2xl bg-primary-600 animate-pulse" />
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 rounded-full bg-primary-400"
              style={{
                animation: `bounce 1s ease-in-out ${i * 0.15}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TestSkeleton() {
  return (
    <div className="flex h-screen bg-slate-50 animate-pulse">
      <div className="flex-1 p-6 space-y-4">
        <Bone className="h-6 w-40" />
        <Bone className="h-48 w-full rounded-2xl" />
        <div className="space-y-3 mt-6">
          {[...Array(4)].map((_, i) => (
            <Bone key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>
      <div className="hidden lg:block w-72 border-l border-slate-200 p-4 space-y-3">
        <Bone className="h-5 w-32" />
        <div className="grid grid-cols-5 gap-2">
          {[...Array(10)].map((_, i) => (
            <Bone key={i} className="h-9 w-9 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

const TYPES = {
  page:      PageSkeleton,
  dashboard: DashboardSkeleton,
  card:      CardSkeleton,
  test:      TestSkeleton,
};

export default function SkeletonLoader({ type = 'page' }) {
  const Component = TYPES[type] || PageSkeleton;
  return <Component />;
}
