// Mantém category como principal para clientes antigos e categories para múltiplas.
function itemCategories(item) {
  const values = [item.category, ...(Array.isArray(item.categories) ? item.categories : [])];
  const seen = new Set();
  return values.map(value => String(value || "").trim()).filter(value => {
    const key = value.toLocaleLowerCase("pt-BR");
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function categoriesFromForm(body) {
  const values = Array.isArray(body.categories) ? body.categories : [body.categories];
  const categories = itemCategories({
    category: body.category,
    categories: [...values, String(body.newCategories || "").split(";")].flat()
  });
  return categories.length ? categories : ["outros"];
}

function allCategoryNames(items, meta = {}) {
  return [...new Set(["filmes", "futebol", "kick", ...Object.keys(meta), ...items.flatMap(itemCategories)])]
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function hasCategory(item, name) {
  return itemCategories(item).some(value => value.toLocaleLowerCase("pt-BR") === String(name).toLocaleLowerCase("pt-BR"));
}

module.exports = { itemCategories, categoriesFromForm, allCategoryNames, hasCategory };
