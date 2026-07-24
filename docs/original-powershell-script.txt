$authors = git shortlog -sn --all | ForEach-Object {
    ($_ -replace '^\s*\d+\s+', '')
}

$result = foreach ($author in $authors) {
    $added = 0
    $deleted = 0

    git log --author="$author" --numstat --pretty=tformat: |
    ForEach-Object {
        $parts = $_ -split "`t"

        if ($parts.Length -eq 3 -and
            $parts[0] -match '^\d+$' -and
            $parts[1] -match '^\d+$') {

            $added += [int]$parts[0]
            $deleted += [int]$parts[1]
        }
    }

    [PSCustomObject]@{
        Author  = $author
        Added   = $added
        Deleted = $deleted
        Net     = $added - $deleted
    }
}

$result | Sort-Object Added -Descending | Format-Table -AutoSize , runing this code inside a git repo in local we get ida about contribution of each person for this project is it possible create web app which allow us to select folder path and then dose thease analysis with good dashboard ui with more advanced funtionalaties