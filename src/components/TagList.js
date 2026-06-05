export default function TagList({ tags }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map(tag => (
        <span key={tag} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">
          {tag}
        </span>
      ))}
    </div>
  );
}
