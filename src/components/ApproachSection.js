export default function ApproachSection({ approach }) {
  return (
    <ol className="space-y-4">
      {approach.map(item => (
        <li key={item.step} className="flex gap-4">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center">
            {item.step}
          </span>
          <div>
            <p className="font-semibold text-white">{item.title}</p>
            <p className="text-gray-400 text-sm mt-0.5">{item.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
