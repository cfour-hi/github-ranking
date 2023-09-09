git config user.name cfour
git config user.email cfour.zhou@gmail.com

git add .
today=`date +"%Y-%m-%d"`
git commit -m "auto update $today"
git push origin main
