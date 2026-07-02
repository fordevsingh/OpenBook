const themeToggle = document.querySelector("#themeToggle");

themeToggle.addEventListener("click", () => {
  document.documentElement.classList.toggle("dark");

  const isDarkMode = document.documentElement.classList.contains("dark");
  themeToggle.textContent = isDarkMode ? "Light mode" : "Dark mode";
});
