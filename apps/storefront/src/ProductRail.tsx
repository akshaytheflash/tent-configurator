const ITEMS = [
  { name: '10 x 20 Custom Canopy Tent', from: '$1,720', img: 'https://mvpvisuals.com/cdn/shop/files/Untitled-1_0003_4.Canopy_Frame_with_Full_Wall.jpg?v=1774630812&width=720' },
  { name: 'Custom Canopy Tent Walls', from: '$118', img: 'https://mvpvisuals.com/cdn/shop/files/5x5_1wall_a671e2c8-2d24-485b-9f65-1abeec3b74b9.jpg?v=1764960129&width=720' },
  { name: 'Logo Stretch Tablecloth', from: '$96', img: 'https://mvpvisuals.com/cdn/shop/files/venture_outdoors_10x10_18e0df97-c359-4bfd-97a9-4f9dd14d79cf_800x.jpg?v=1691515919' },
  { name: 'Inflatable Arch', from: '$640', img: 'https://mvpvisuals.com/cdn/shop/files/Tents-31_c9cb1fc3-0e0c-4c55-93c0-e4ec4670716a_800x.jpg?v=1691515919' },
];

export function ProductRail() {
  return (
    <section className="rail">
      <h2>More custom displays</h2>
      <div className="rail-grid">
        {ITEMS.map((item) => (
          <a key={item.name} href="#product" className="rail-card">
            <img src={item.img} alt="" loading="lazy" />
            <span>{item.name}</span>
            <em>from {item.from}</em>
          </a>
        ))}
      </div>
    </section>
  );
}
